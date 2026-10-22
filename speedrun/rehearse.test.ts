import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { baseState, FakeSdk } from './lib/fake-sdk';
import type { DirectVerdict, GateCheck } from './lib/hostgate';
import type { ProgramStatus } from './lib/programs';
import type { FrameCheck, FrontWindows, RecordingState, XWindow } from './lib/display';
import { type ClientKind, LOGOUT_BUTTON, logoutClean, type LogoutResult, type Session, startWatchdog } from './lib/session';
import type { TabFront } from './lib/tab';
import { TickLog, type TickRow } from './lib/ticks';
import { sleep, waitUntil } from './lib/wait';
import type { Link } from './runner/resume';
import { BOUNDARY_STEP, type Step } from './runner/step';
import {
    annotation, compareHiscore, DEFAULT_ATTEMPT_KIND, DEFAULT_GATE_BOT, kindGate, kindText, RECORD_LINE, recordLineAt, type DirectRead, EXIT_HOST_RESERVED, formatPlayers, formatSummary, GATE_PLAYERS_STEP, gateRefusal, type InPageRead, kitMissing, kitWant,
    parseArgs, parseDirectJson, parseKit, PAUSE_STEP, playerReads, playerSwing, ProgramTracker, ReachTracker, readReservation, reservationPath, reservationRefusal, ReservationWatch,
    runAttempt, SessionClock, summarize, UsageError, claimBin, claimOwner, claimToucher, type ClaimTouch, judgeReservation,
    attemptFront, bracketAttempt, type FrontIO, frontLine, type FrontReport, gateTabProblems, gateTabRead, recordingProblems, type TabIO, hiscoreSettled,
} from './rehearse';
import { parsePlayer, type PlayerRow } from './tools/hiscore-scrape';

describe('parseArgs', () => {
    test('defaults: browser, to 99, no probes on the rehearsal clock', () => {
        expect(parseArgs(['--skill=woodcutting', '--bot=cairn_wc'])).toEqual({
            skill: 'woodcutting', claim: false, bot: 'cairn_wc', client: 'browser', to: 99, lab: false, skillOpts: {}, gateProbeTrials: 0, probeTrials: 0, forceGate: false, kind: 'measurement',
        });
    });

    test('--claim: S00 and logout only, one login: no skill, no gate account even off a local world, no probes', () => {
        const demo = { defaultGateBot: DEFAULT_GATE_BOT };
        const a = parseArgs(['--claim', '--bot=cairn_swings', '--log=/tmp/c.jsonl'], demo);
        expect(a).toEqual({ claim: true, bot: 'cairn_swings', client: 'browser', to: 99, lab: false, skillOpts: {}, gateProbeTrials: 0, probeTrials: 0, forceGate: false, kind: 'measurement', log: '/tmp/c.jsonl' });
        expect(a.gateBot).toBeUndefined();
        expect(parseArgs(['cairn_x', '--claim', '--client=lite', '--lab']).claim).toBe(true);
        for (const extra of ['--skill=x', '--to=15', '--gate-bot=cairn_twin', '--gate-json=/tmp/g.json', '--gate-probe-trials=60', '--probe-trials=20', '--force-gate', '--from=2', '--technique=plain', '--skill-opt=idle=1', '--kit-from=m', '--kind=record', '--kind=measurement']) {
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
    path: 'direct', on: c.ok !== false, status: c.ok === false ? 're-measure' : 'pass', onTime: 60, trials: 60, passAt: 60, floorAt: 58, lead: 0, failures: [], T: 300, TSource: 'feed',
    checks: [{ id: 'a', name: 'on-time trials', role: 'pass', ok: true, value: 60, limit: 58 }, { id: 'b', name: 'tick p90', role: 'report', ok: true, value: 310, limit: 400 }, c, { id: 'd', name: 'loop rate p10', role: 'pass', ok: null, value: null, limit: 50 }],
});
const now = Date.parse('2026-10-21T20:00:00Z');
const read = (c: GateCheck, over: Partial<DirectRead> = {}): DirectRead => ({ source: 'gate-bot', takenAt: '2026-10-21T19:58:00Z', verdict: verdict(c), vantage: null, ...over });
const page = (c: GateCheck, label = 'gate tab before'): InPageRead => ({ label, account: 'cairn_twin', verdict: verdict(c), loopRateP10: 72, at: '' });
/** A direct read with `onTime` of `trials` next-tick reactions, and (c) passing or failing. */
const onTimeRead = (onTime: number, cOk: boolean, trials = 60): DirectRead => {
    const v = verdict(checkC(cOk));
    v.onTime = onTime;
    v.trials = trials;
    v.checks[0] = { ...v.checks[0]!, value: onTime, ok: onTime >= 58 };
    return read(checkC(cOk), { verdict: v });
};

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

    test('the kind defaults to measurement, which refuses exactly as before', () => {
        const cases: Parameters<typeof gateRefusal>[0][] = [
            { direct: read(checkC(true)), inPage: [page(checkC(true))], players: 41, local: false, now },
            { direct: read(checkC(false)), inPage: [], players: 41, local: false, now },
            { direct: read(checkC(true)), inPage: [page(checkC(false, 3))], players: 41, local: false, now },
            { direct: onTimeRead(57, true), inPage: [], players: 41, local: false, now },
            { direct: onTimeRead(20, true, 20), inPage: [], players: 41, local: false, now },
            { direct: null, inPage: [], players: 41, local: false, now },
            { direct: null, inPage: [], players: null, local: true, now },
            { direct: read(checkC(true), { verdict: null, error: 'boom' }), inPage: [], players: 41, local: false, now },
            { direct: read(checkC(true), { source: 'gate-json', takenAt: null }), inPage: [], players: null, local: false, now },
        ];
        for (const c of cases) expect(gateRefusal({ ...c, kind: 'measurement' })).toEqual(gateRefusal(c));
    });

    test('parseDirectJson takes what tickmanip-latency --json writes', () => {
        const v = verdict(checkC(true));
        expect(parseDirectJson({ path: 'direct', startedUtc: '2026-10-21T19:58:00Z', verdict: v, result: {} }, 'gate-json')).toEqual({ source: 'gate-json', takenAt: '2026-10-21T19:58:00Z', vantage: null, verdict: v });
        expect(parseDirectJson({ path: 'relay' }, 'gate-json').error).toContain('not a tickmanip-latency');
    });
});

describe('record attempt kind', () => {
    const live = { inPage: [], players: 1540, local: false, now } as const;

    test('the default kind is measurement; --kind=record selects the record rule', () => {
        expect(DEFAULT_ATTEMPT_KIND).toBe('measurement');
        expect(parseArgs(['--skill=x', '--bot=b']).kind).toBe('measurement');
        expect(parseArgs(['--skill=x', '--bot=b', '--kind=measurement']).kind).toBe('measurement');
        expect(parseArgs(['--skill=x', '--bot=b', '--kind=record'], { defaultGateBot: DEFAULT_GATE_BOT }).kind).toBe('record');
        expect(() => parseArgs(['--skill=x', '--bot=b', '--kind=race'])).toThrow('--kind must be measurement or record, not "race"');
        expect(() => parseArgs(['--skill=x', '--bot=b', '--kind'])).toThrow('--kind needs a value');
    });

    test('--force-gate cannot start a record attempt; a measurement keeps it', () => {
        expect(() => parseArgs(['--skill=x', '--bot=b', '--kind=record', '--force-gate'])).toThrow(UsageError);
        expect(() => parseArgs(['--skill=x', '--bot=b', '--force-gate', '--kind=record'])).toThrow('--force-gate cannot start a record attempt');
        expect(parseArgs(['--skill=x', '--bot=b', '--force-gate']).forceGate).toBe(true);
    });

    test('record + 57/60 with (c) ok refuses, naming (a)', () => {
        expect(gateRefusal({ ...live, direct: onTimeRead(57, true), kind: 'record' })).toEqual([
            'record attempt: (a) 57/60 next-tick reactions on the direct read, under the record line of 58/60: wait and re-read (or run it as --kind=measurement)',
        ]);
    });

    test('record + 58/60 with (c) ok proceeds; 60/60 is not the line', () => {
        expect(gateRefusal({ ...live, direct: onTimeRead(58, true), kind: 'record' })).toEqual([]);
        expect(gateRefusal({ ...live, direct: onTimeRead(59, true), kind: 'record' })).toEqual([]);
        expect(gateRefusal({ ...live, direct: onTimeRead(60, true), kind: 'record' })).toEqual([]);
    });

    test('record + 60/60 with (c) failing refuses, naming (c)', () => {
        expect(gateRefusal({ ...live, direct: onTimeRead(60, false), kind: 'record' })).toEqual([
            '(c) 4 catch-ups per minute over 2 on the direct read: an overrun period; wait and re-read',
        ]);
        // Both short: both criteria are named.
        expect(gateRefusal({ ...live, direct: onTimeRead(50, false), kind: 'record' })).toHaveLength(2);
    });

    test('measurement + 57/60 with (c) ok proceeds (unchanged)', () => {
        expect(gateRefusal({ ...live, direct: onTimeRead(57, true), kind: 'measurement' })).toEqual([]);
        expect(gateRefusal({ ...live, direct: onTimeRead(57, true) })).toEqual([]);
    });

    test('a record attempt needs a full direct read, on the lab too', () => {
        expect(gateRefusal({ ...live, direct: null, local: true, players: null, kind: 'record' })[0]).toContain('record attempt: no direct gate read');
        expect(gateRefusal({ ...live, direct: null, kind: 'record' })).toHaveLength(1);
        expect(gateRefusal({ ...live, direct: onTimeRead(20, true, 20), kind: 'record' })[0]).toContain('ran 20 trials, under the 60');
        expect(gateRefusal({ ...live, direct: read(checkC(true), { verdict: null, error: 'boom' }), kind: 'record' })).toEqual(['direct gate read failed: boom']);
    });

    test('the record line scales to a longer read, rounded up', () => {
        expect(RECORD_LINE).toEqual({ onTime: 58, trials: 60 });
        expect(recordLineAt(60)).toBe(58);
        expect(recordLineAt(120)).toBe(116);
        expect(recordLineAt(100)).toBe(97);
        expect(gateRefusal({ ...live, direct: onTimeRead(115, true, 120), kind: 'record' })[0]).toContain('115/120');
        expect(gateRefusal({ ...live, direct: onTimeRead(116, true, 120), kind: 'record' })).toEqual([]);
    });

    test('the (gate) kind row and the summary line carry the kind, its rule and the gate numbers', () => {
        const rec = kindGate('record', onTimeRead(57, true));
        expect(rec).toMatchObject({ kind: 'record', onTime: 57, trials: 60, recordLine: 58, recordHeld: false, catchUpsPerMinute: 0.5, catchUpLimit: 2 });
        expect(rec.recordShort).toContain('57/60');
        expect(kindText(rec)).toBe('kind: record (refuses below 58/60 next-tick reactions on the direct read, and on (c); no --force-gate); direct (a) 57/60, line 58 SHORT; (c) 0.5/min, limit 2');
        expect(kindGate('record', onTimeRead(58, true))).toMatchObject({ recordHeld: true });
        expect(kindGate('record', onTimeRead(58, true)).recordShort).toBeUndefined();
        const meas = kindGate('measurement', onTimeRead(57, true));
        expect(meas).toMatchObject({ kind: 'measurement', onTime: 57, recordLine: null, recordHeld: null });
        expect(kindText(meas)).toBe('kind: measurement (refuses on (c) only); direct (a) 57/60; (c) 0.5/min, limit 2');
        expect(kindText(kindGate('measurement', null))).toBe('kind: measurement (refuses on (c) only); no direct read');
        expect(kindGate('record', null)).toMatchObject({ recordHeld: false, recordShort: 'record attempt: no direct gate read' });
        const s = formatSummary(summarize([]), { account: 'a', skill: 'x', outcome: 'refused', gate: [kindText(rec)], hiscore: null });
        expect(s).toContain('gate: kind: record');
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

    test('each check records the tick length its row\'s title stated, and the summary prints it', () => {
        const s = summarize([reached('woodcutting', 15, 41), session(60)]);
        const rows = player([[0, 'Overall', 46, 41], [9, 'Woodcutting', 15, 42]]).map(r => ({ ...r, tickMs: 400 }));
        const checks = compareHiscore(s, rows, 'woodcutting');
        expect(checks).toEqual([
            { row: 'Woodcutting 15', hiscore: 42, expected: 41, diff: 1, ok: true, basis: 'level 15 reached in the log', tickMs: 400 },
            { row: 'Overall', hiscore: 41, expected: 41, diff: 0, ok: true, basis: 'the latest level gained in the log', tickMs: 400 },
        ]);
        const text = formatSummary(s, { account: 'a', skill: 'woodcutting', to: 15, outcome: 'chain done', gate: [], hiscore: checks });
        expect(text).toContain('hiscore Woodcutting 15: 42 at 400 ms/tick vs log 41 (+1) ok');
    });
});

// Live demo player pages (speedrun/tools/fixtures/hiscore, fetched 2026-10-22 22:42-22:47Z in the
// `N ticks normalized to 400 ms per tick` form; cairn_chops's from earlier that day, identical but for its rank).
const page = (name: string): PlayerRow[] => parsePlayer(readFileSync(join(import.meta.dir, 'tools', 'fixtures', 'hiscore', name), 'utf8'))!;
const runesPage = () => page('player-cairn_runes-2026-10-22-400ms.html');
const sub15Page = () => page('player-cairn_h90-2026-10-22-400ms.html');
const unsavedPage = () => page('player-acquiredl13-unsaved-2026-10-22.html');
// rs/461's cairn_runes log: Runecraft 70 at playtime 4,544, logout click on session tick 4,604.
const runesLog = () => summarize([reached('runecraft', 70, 4544), session(4604)]);

describe('compareHiscore on live player pages', () => {
    test('cairn_runes (rs/461): Runecraft 70 at 4,543, one tick under the log, not "under level 15"', () => {
        expect(compareHiscore(runesLog(), runesPage(), 'runecraft')).toEqual([
            { row: 'Runecraft 70', hiscore: 4543, expected: 4544, diff: -1, ok: true, basis: 'level 70 reached in the log', tickMs: 400 },
            { row: 'Overall', hiscore: 4543, expected: 4544, diff: -1, ok: true, basis: 'the latest level gained in the log', tickMs: 400 },
        ]);
    });

    test('the 99 rows: cairn_jumps Agility, cairn_ashes Firemaking, cairn_chops Woodcutting', () => {
        for (const [file, skill, ticks] of [
            ['player-cairn_jumps-2026-10-22-400ms.html', 'agility', 7111],
            ['player-cairn_ashes-2026-10-22-400ms.html', 'firemaking', 664],
            ['player-cairn_chops-2026-10-22-400ms.html', 'woodcutting', 3329],
        ] as const) {
            const s = summarize([reached(skill, 99, ticks), session(ticks + 5)]);
            const checks = compareHiscore(s, page(file), skill);
            expect(checks[0]).toMatchObject({ row: `${skill[0]!.toUpperCase()}${skill.slice(1)} 99`, hiscore: ticks, expected: ticks, diff: 0, ok: true, tickMs: 400 });
            expect(checks[1]).toMatchObject({ row: 'Overall', hiscore: ticks, ok: true });
        }
    });

    test('a real sub-15 row stays "under level 15": cairn_h90 (every skill under 15) and cairn_runes\'s Attack', () => {
        const s = summarize([reached('woodcutting', 5, 40), session(59251)]);
        expect(compareHiscore(s, sub15Page(), 'woodcutting')).toEqual([
            { row: 'Woodcutting', hiscore: null, expected: null, diff: null, ok: null, basis: 'no row (under level 15)' },
            { row: 'Overall', hiscore: 59252, expected: 40, diff: 59212, ok: false, basis: 'the latest level gained in the log', tickMs: 400 },
        ]);
        expect(compareHiscore(runesLog(), runesPage(), 'attack')[0]).toEqual({ row: 'Attack', hiscore: null, expected: null, diff: null, ok: null, basis: 'no row (under level 15)' });
    });

    test('read before the save landed: an unsaved page says so, and a blank row the log took past 15 is not "under level 15"', () => {
        // rs/461's case: the page parsed, but its first save had not landed, so every row was blank.
        expect(compareHiscore(runesLog(), unsavedPage(), 'runecraft')).toEqual([
            { row: 'player', hiscore: null, expected: null, diff: null, ok: null, basis: 'no rows saved yet (read before the logout save landed)' },
        ]);
        const s = summarize([reached('woodcutting', 20, 300), session(400)]);
        expect(compareHiscore(s, sub15Page(), 'woodcutting')[0]!.basis).toBe('no row, though the log reached level 20 (read before this attempt\'s save landed)');
    });
});

describe('hiscoreSettled', () => {
    test('the page shows the attempt\'s save: Overall stamped and the skill at the log\'s last level', () => {
        expect(hiscoreSettled(runesLog(), runesPage(), 'runecraft')).toBe(true);
        expect(hiscoreSettled(summarize([session(10)]), sub15Page(), 'woodcutting')).toBe(true);
        expect(hiscoreSettled(summarize([reached('woodcutting', 5, 4), session(10)]), sub15Page(), 'woodcutting')).toBe(true);
    });

    test('not yet: no page, no save (rs/461), or a page from before this attempt\'s save', () => {
        expect(hiscoreSettled(runesLog(), null, 'runecraft')).toBe(false);
        expect(hiscoreSettled(runesLog(), unsavedPage(), 'runecraft')).toBe(false);
        expect(hiscoreSettled(summarize([reached('runecraft', 71, 4700), session(4800)]), runesPage(), 'runecraft')).toBe(false);
        expect(hiscoreSettled(summarize([reached('woodcutting', 15, 300), session(400)]), sub15Page(), 'woodcutting')).toBe(false);
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

/** ~/host-reserved.json as rs-claim (host's claim lock) writes it: a take, and host's preempt of a holder. */
const claimJson = (owner: string, until: string) =>
    JSON.stringify({ owner, logins: 2, what: 'firemaking attempt', reason: 'firemaking attempt', taken: '2026-10-22T03:30:00Z', touched: '2026-10-22T03:30:00Z', until });
const preemptJson = (displaced: string, until: string) =>
    JSON.stringify({
        owner: 'host', logins: 1, what: 'gate series', reason: 'gate series', taken: '2026-10-22T03:40:00Z', touched: '2026-10-22T03:40:00Z', starts: '2026-10-22T03:45:00Z', until,
        displaced: { owner: displaced, logins: 2, what: 'firemaking attempt', until: '2026-10-22T04:40:00Z' },
    });

describe('host reservation: the claim the attempt runs under (pre-flight)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rehearse-claim-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    const at = Date.parse('2026-10-22T04:00:00Z');
    const file = (name: string, text: string) => {
        const p = join(dir, name);
        writeFileSync(p, text);
        return p;
    };
    const watch = (path: string, owner?: string) => {
        const warnings: string[] = [];
        return { w: new ReservationWatch(path, { now: () => at, warn: m => warnings.push(m), ...(owner ? { owner } : {}) }), warnings };
    };

    test('the owner: --claim-owner, else $SPEEDRUN_CLAIM_OWNER, else none', () => {
        expect(claimOwner(undefined, {})).toBeUndefined();
        expect(claimOwner(undefined, { SPEEDRUN_CLAIM_OWNER: 'rs/228' })).toBe('rs/228');
        expect(claimOwner('rs/229', { SPEEDRUN_CLAIM_OWNER: 'rs/228' })).toBe('rs/229');
        expect(claimOwner(undefined, { SPEEDRUN_CLAIM_OWNER: '  ' })).toBeUndefined();
        expect(parseArgs(['--skill=x', '--bot=b', '--claim-owner=rs/228']).claimOwner).toBe('rs/228');
        expect(parseArgs(['--claim', '--bot=b', '--claim-owner=rs/228'], { defaultGateBot: DEFAULT_GATE_BOT }).claimOwner).toBe('rs/228');
        expect(parseArgs(['--skill=x', '--bot=b']).claimOwner).toBeUndefined();
        expect(() => parseArgs(['--skill=x', '--bot=b', '--claim-owner'])).toThrow('--claim-owner needs a value');
    });

    test('rs-claim\'s file parses: a take as a plain reservation, a preempt naming whom it displaced', () => {
        expect(judgeReservation(claimJson('rs/228', '2026-10-22T04:30:00Z'), at)).toEqual({ state: 'live', reservation: { owner: 'rs/228', until: '2026-10-22T04:30:00Z', reason: 'firemaking attempt' } });
        expect(judgeReservation(preemptJson('rs/228', '2026-10-22T05:00:00Z'), at)).toEqual({ state: 'live', reservation: { owner: 'host', until: '2026-10-22T05:00:00Z', reason: 'gate series', displaced: 'rs/228' } });
    });

    test('our own live claim: passes, silently', () => {
        const { w, warnings } = watch(file('own.json', claimJson('rs/228', '2026-10-22T04:30:00Z')), 'rs/228');
        expect(reservationRefusal(w)).toBeNull();
        expect(warnings).toEqual([]);
    });

    test('another owner\'s live claim: refused, as without an owner', () => {
        const p = file('other.json', claimJson('rs/247', '2026-10-22T04:30:00Z'));
        const why = reservationRefusal(watch(p, 'rs/228').w);
        expect(why).toContain('the host is reserved by rs/247 until 2026-10-22T04:30:00Z (firemaking attempt)');
        expect(why).toContain('not our claim (rs/228)');
        // Without --claim-owner every live claim refuses, ours included (unchanged).
        expect(reservationRefusal(watch(file('own-unnamed.json', claimJson('rs/228', '2026-10-22T04:30:00Z'))).w)).toContain('reserved by rs/228');
    });

    test('host\'s preempt of our claim: refused, naming the preempt', () => {
        const why = reservationRefusal(watch(file('preempt.json', preemptJson('rs/228', '2026-10-22T05:00:00Z')), 'rs/228').w);
        expect(why).toContain('reserved by host until 2026-10-22T05:00:00Z (gate series), preempting rs/228');
        expect(why).toContain('which preempts our claim (rs/228)');
    });

    test('our claim gone stale: passes with one warning (nobody else holds the machine)', () => {
        const { w, warnings } = watch(file('stale.json', claimJson('rs/228', '2026-10-22T03:59:00Z')), 'rs/228');
        expect(reservationRefusal(w)).toBeNull();
        expect(reservationRefusal(w)).toBeNull();
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('our claim went stale (rs/228 until 2026-10-22T03:59:00Z');
        expect(warnings[0]).toContain('rs-claim touch rs/228');
    });

    test('no file and malformed: not live, as without an owner (no file under an owner warns that no claim is held)', () => {
        const none = watch(join(dir, 'absent.json'), 'rs/228');
        expect(reservationRefusal(none.w)).toBeNull();
        expect(none.warnings).toHaveLength(1);
        expect(none.warnings[0]).toContain('no claim in');
        const torn = watch(file('torn.json', '{"owner": "rs/228", "until": '), 'rs/228');
        expect(reservationRefusal(torn.w)).toBeNull();
        expect(reservationRefusal(torn.w)).toBeNull();
        expect(torn.warnings).toHaveLength(1);
        expect(torn.warnings[0]).toContain('is malformed, so it is not a live reservation: not JSON');
    });
});

describe('rs-claim touch (best-effort, against a fake rs-claim)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rehearse-rsclaim-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    const fake = (name: string, body: string) => {
        const p = join(dir, name);
        writeFileSync(p, `#!/bin/sh\necho "$@" >> "$0.calls"\n${body}\n`);
        chmodSync(p, 0o755);
        return p;
    };

    test('finds rs-claim on PATH, else in ~/.local/bin, else nowhere', () => {
        const home = join(dir, 'home');
        mkdirSync(join(home, '.local', 'bin'), { recursive: true });
        expect(claimBin({ HOME: home, PATH: '' })).toBeNull();
        const local = join(home, '.local', 'bin', 'rs-claim');
        writeFileSync(local, '#!/bin/sh\n');
        chmodSync(local, 0o755);
        expect(claimBin({ HOME: home, PATH: '' })).toBe(local);
        const pathDir = join(dir, 'path');
        mkdirSync(pathDir);
        writeFileSync(join(pathDir, 'rs-claim'), '#!/bin/sh\n');
        chmodSync(join(pathDir, 'rs-claim'), 0o755);
        expect(claimBin({ HOME: home, PATH: pathDir })).toBe(join(pathDir, 'rs-claim'));
    });

    test('exit codes and output come back; a hung touch is killed at the timeout', async () => {
        const ok = fake('ok', 'echo "rs/228 logins=2 until=2026-10-22T04:40:00Z (live)"; exit 0');
        expect(await claimToucher(ok)('rs/228')).toEqual({ code: 0, out: 'rs/228 logins=2 until=2026-10-22T04:40:00Z (live)' });
        expect(readFileSync(`${ok}.calls`, 'utf-8')).toBe('touch rs/228\n');
        const pre = fake('pre', 'echo "PREEMPTED: host logins=1"; exit 3');
        expect(await claimToucher(pre)('rs/228')).toEqual({ code: 3, out: 'PREEMPTED: host logins=1' });
        const hung = fake('hung', 'exec sleep 5');
        const t0 = Date.now();
        const r = await claimToucher(hung, 200)('rs/228');
        expect(r.code).toBeNull();
        expect(Date.now() - t0).toBeLessThan(3_000);
        expect((await claimToucher(join(dir, 'missing'))('rs/228')).code).toBeNull();
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
            ticksSinceProgress: 0, watchdog: null, logPath: '/dev/null',
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
        // The runner's own logout boundary, after step one, sits just before it.
        const out = tlog.rows.findIndex(x => x.step === BOUNDARY_STEP && x.meta?.to === '(logout)');
        expect(tlog.rows[out]!.meta).toMatchObject({ from: 'one', index: 1 });
        expect(tlog.rows.indexOf(pause[0]!)).toBe(out + 1);

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

    /** runAttempt over the three-step chain under `owner`'s claim; `between` rewrites the file after a step. */
    async function underClaim(path: string, owner: string, between: Record<string, () => void>, opts: { touch?: (o: string) => Promise<ClaimTouch> } = {}) {
        const client = liteClient();
        const ran: string[] = [];
        const warnings: string[] = [];
        const tlog = TickLog.memory('claim');
        const reservation = new ReservationWatch(path, { owner, warn: m => warnings.push(m), ...(opts.touch ? { touch: opts.touch, touchEveryMs: 0 } : {}) });
        const r = await runAttempt(client.session, chain(ran, between), {
            log: tlog, account: 'srtest', link: client.link, from: 0,
            reservation, stopAsked: () => false, gateStop: () => null,
            logout: () => logoutClean(client.session),
        });
        client.stop();
        await reservation.settled();
        return { r, ran, warnings, tlog, client };
    }

    test('under our own live claim: the chain finishes, no logout, and the claim is touched at boundaries', async () => {
        const path = join(dir, 'own.json');
        writeFileSync(path, claimJson('rs/228', inAnHour()));
        const touched: string[] = [];
        const { r, ran, warnings, client } = await underClaim(path, 'rs/228', {}, { touch: async o => (touched.push(o), { code: 0, out: 'live' }) });
        expect(ran).toEqual(['one', 'two', 'three']);
        expect(r).toEqual({ outcome: 'chain done', code: 0, paused: null });
        expect(client.logoutClicks()).toBe(0);
        expect(touched.length).toBeGreaterThanOrEqual(1);
        expect(new Set(touched)).toEqual(new Set(['rs/228']));
        expect(warnings).toEqual([]);
    });

    test('host preempts our claim between two steps: clean logout there, the pause row naming the preempt, exit 5', async () => {
        const path = join(dir, 'preempted.json');
        writeFileSync(path, claimJson('rs/228', inAnHour()));
        const until = inAnHour();
        const { r, ran, tlog, client } = await underClaim(path, 'rs/228', { one: () => writeFileSync(path, preemptJson('rs/228', until)) });
        expect(ran).toEqual(['one']);
        expect(r.code).toBe(EXIT_HOST_RESERVED);
        expect(r.paused).toEqual({ owner: 'host', until, reason: 'gate series', displaced: 'rs/228' });
        expect(r.outcome).toContain(`PAUSED for the gate/run: the host is reserved by host until ${until} (gate series), preempting rs/228; logged out before "two"`);
        expect(client.logoutClicks()).toBe(1);
        expect(client.session.expectInWorld).toBe(false);
        const pause = tlog.rows.filter(x => x.kind === 'gate' && x.step === PAUSE_STEP);
        expect(pause).toHaveLength(1);
        expect(pause[0]!.meta).toMatchObject({ owner: 'host', displaced: 'rs/228', path, before: 'two', logout: { ok: true } });
    });

    test('another owner holding the machine mid-run (our claim lost): the same pause', async () => {
        const path = join(dir, 'taken.json');
        writeFileSync(path, claimJson('rs/228', inAnHour()));
        const { r, ran, client } = await underClaim(path, 'rs/228', { two: () => writeFileSync(path, claimJson('rs/247', inAnHour())) });
        expect(ran).toEqual(['one', 'two']);
        expect(r.code).toBe(EXIT_HOST_RESERVED);
        expect(r.paused?.owner).toBe('rs/247');
        expect(client.logoutClicks()).toBe(1);
    });

    test('our claim gone stale mid-run: one warning, and the chain finishes', async () => {
        const path = join(dir, 'stale.json');
        writeFileSync(path, claimJson('rs/228', inAnHour()));
        const { r, ran, warnings, client } = await underClaim(path, 'rs/228', { one: () => writeFileSync(path, claimJson('rs/228', '2026-10-21T00:00:00Z')) });
        expect(ran).toEqual(['one', 'two', 'three']);
        expect(r).toEqual({ outcome: 'chain done', code: 0, paused: null });
        expect(client.logoutClicks()).toBe(0);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('our claim went stale');
    });

    test('a touch that exits 3 (preempted) pauses at the next boundary, though the file still reads ours', async () => {
        const path = join(dir, 'touch3.json');
        writeFileSync(path, claimJson('rs/228', inAnHour()));
        const touched: string[] = [];
        const { r, ran, client } = await underClaim(path, 'rs/228', {}, { touch: async o => (touched.push(o), { code: 3, out: 'PREEMPTED: host logins=1' }) });
        expect(touched).toEqual(['rs/228']);
        expect(ran).toEqual(['one', 'two']);
        expect(r.code).toBe(EXIT_HOST_RESERVED);
        expect(r.paused).toMatchObject({ owner: 'host', displaced: 'rs/228' });
        expect(r.paused?.reason).toContain('rs-claim touch exited 3: PREEMPTED: host logins=1');
        expect(client.logoutClicks()).toBe(1);
    });

    test('a touch that fails otherwise warns once and changes nothing', async () => {
        const path = join(dir, 'touch1.json');
        writeFileSync(path, claimJson('rs/228', inAnHour()));
        const { r, ran, warnings } = await underClaim(path, 'rs/228', {}, { touch: async () => ({ code: null, out: 'no answer in 10 s' }) });
        expect(ran).toEqual(['one', 'two', 'three']);
        expect(r.code).toBe(0);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('rs-claim touch rs/228 did not answer: no answer in 10 s');
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

describe('the gate tab and the attempt never share the recorded display', () => {
    const okVerdict = verdict(checkC(true));
    const out = (ok: boolean): LogoutResult => (ok ? { ok, clickTick: 9, lastInWorldTick: 9, latencyTicks: 0, wallMs: 200, confirmedBy: 'page' } : { ok, clickTick: 9, lastInWorldTick: 9, latencyTicks: 0, wallMs: 5000, reason: 'still in game after timeout' });
    const recording = (on: boolean | null): RecordingState => ({ display: ':10', on, ...(on ? { pid: 7, file: 'rec.mkv' } : {}) });

    /** Every session and display event in order, over FakeSdk sessions. `recordings` answers io.recording() in turn (the last repeats). */
    function fakeIO(o: { probeThrows?: boolean; gateLogout?: boolean; openThrows?: string; recordings?: (boolean | null)[]; closeThrows?: string } = {}) {
        const events: string[] = [];
        const recs = [...(o.recordings ?? [true, false])];
        const io: TabIO = {
            open: async (bot: string, client: ClientKind) => {
                events.push(`open ${bot} ${client}`);
                if (o.openThrows === bot) throw new Error('no in-game state within 120000 ms');
                return { name: bot, client, sdk: new FakeSdk(baseState()), expectInWorld: true, sessionId: 1 } as unknown as Session;
            },
            probe: async (s, trials, label) => {
                events.push(`probe ${s.name} ${trials}`);
                if (o.probeThrows) throw new Error('the page published no loops');
                return { label, account: s.name, verdict: okVerdict, loopRateP10: 72, at: '' };
            },
            logout: async s => {
                events.push(`logout ${s.name}`);
                return out(o.gateLogout ?? true);
            },
            stage: async bot => {
                events.push(`stage ${bot}`);
                return { how: 'opened', was: 'normal' };
            },
            closeTab: async s => {
                events.push(`closeTab ${s.name}`);
                if (o.closeThrows) throw new Error(o.closeThrows);
                return { closed: 1, left: [] };
            },
            close: async s => void events.push(`close ${s.name}`),
            front: async s => {
                events.push(`front ${s.name}`);
                return { ok: true, mark: s.name, display: ':10', tab: null, windows: null, frame: null, raised: false, warnings: [] };
            },
            recording: async () => {
                const on = recs.length > 1 ? recs.shift()! : recs[0]!;
                events.push(`recording ${on}`);
                return recording(on);
            },
            pause: async () => void events.push('pause'),
        };
        return { io, events };
    }
    const gateBefore = ['open cairn_twin browser', 'probe cairn_twin 60', 'logout cairn_twin', 'stage cairn_smoke', 'closeTab cairn_twin', 'close cairn_twin'];
    const gateAfter = ['open cairn_twin browser', 'probe cairn_twin 60', 'logout cairn_twin', 'closeTab cairn_twin', 'close cairn_twin'];
    const opts = { gateBot: 'cairn_twin', gateProbeTrials: 60, bot: 'cairn_smoke', client: 'browser' as const };

    function hooks(events: string[], o: { refuse?: string[]; loggedOut?: boolean; skipAfter?: string } = {}) {
        const gates: string[] = [];
        const fronts: FrontReport[] = [];
        const recordings: RecordingState[] = [];
        return {
            gates,
            fronts,
            recordings,
            h: {
                gate: (r: { when: string }) => void gates.push(r.when),
                refusal: (_: unknown, rec: RecordingState) => {
                    recordings.push(rec);
                    return o.refuse ? { code: 3, reasons: o.refuse } : null;
                },
                front: (f: FrontReport) => void fronts.push(f),
                waiting: () => void events.push('waiting'),
                attempt: async (s: Session) => {
                    events.push(`attempt ${s.name}`);
                    return { value: 'chain done', loggedOut: o.loggedOut ?? true, ...(o.skipAfter ? { skipAfter: o.skipAfter } : {}) };
                },
            },
        };
    }

    test('gate out, attempt window staged, gate window closed, recording read, then the login; the after-probe once the recording stops', async () => {
        const { io, events } = fakeIO({ recordings: [true, true, true, false] });
        const { h, gates, fronts, recordings } = hooks(events);
        const r = await bracketAttempt(io, opts, h, { pollMs: 1 });
        expect(events).toEqual([
            ...gateBefore, 'recording true', 'open cairn_smoke browser', 'front cairn_smoke', 'attempt cairn_smoke',
            'recording true', 'waiting', 'pause', 'recording true', 'pause', 'recording false', ...gateAfter,
        ]);
        expect(gates).toEqual(['before', 'after']);
        expect(recordings.map(x => x.on)).toEqual([true]);
        expect(fronts.map(f => f.ok)).toEqual([true]);
        expect(r.value).toBe('chain done');
        expect(r.before?.staged).toEqual({ how: 'opened', was: 'normal' });
        expect(r.after?.read?.label).toBe('gate tab after');
        expect(r.refused).toBeNull();
    });

    test('a recording that does not stop: no gate window is opened on it', async () => {
        const { io, events } = fakeIO({ recordings: [true] });
        const r = await bracketAttempt(io, opts, hooks(events).h, { recordingWaitMs: 5, pollMs: 1 });
        expect(events.filter(e => e.startsWith('open'))).toEqual(['open cairn_twin browser', 'open cairn_smoke browser']);
        expect(r.after).toBeNull();
        expect(r.afterSkipped).toContain('the recording on :10 was still running');
    });

    test('a refusal opens nothing for the attempt, and the gate account is already out', async () => {
        const { io, events } = fakeIO();
        const r = await bracketAttempt(io, opts, hooks(events, { refuse: ['(c) 4 catch-ups per minute'] }).h);
        expect(events).toEqual([...gateBefore, 'recording true']);
        expect(r.refused).toEqual({ code: 3, reasons: ['(c) 4 catch-ups per minute'] });
        expect(r.session).toBeUndefined();
    });

    test('the after-probe waits for the attempt\'s confirmed logout, and skips when the attempt paused for the gate/run', async () => {
        const a = fakeIO();
        const r = await bracketAttempt(a.io, opts, hooks(a.events, { loggedOut: false }).h);
        expect(a.events.at(-1)).toBe('attempt cairn_smoke');
        expect(r.afterSkipped).toContain("cairn_smoke's logout was not confirmed");
        const b = fakeIO();
        const p = await bracketAttempt(b.io, opts, hooks(b.events, { skipAfter: 'paused for the gate/run' }).h);
        expect(b.events.at(-1)).toBe('attempt cairn_smoke');
        expect(p.afterSkipped).toBe('paused for the gate/run');
    });

    test('no gate probes: no gate tab, no staging, no after-probe wait', async () => {
        const { io, events } = fakeIO();
        const r = await bracketAttempt(io, { ...opts, gateProbeTrials: 0 }, hooks(events).h);
        expect(events).toEqual(['recording true', 'open cairn_smoke browser', 'front cairn_smoke', 'attempt cairn_smoke']);
        expect(r.before).toBeNull();
        expect(r.after).toBeNull();
    });

    test('a lite attempt stages no window', async () => {
        const { io, events } = fakeIO();
        await bracketAttempt(io, { ...opts, client: 'lite' }, hooks(events).h);
        expect(events.slice(0, 5)).toEqual(['open cairn_twin browser', 'probe cairn_twin 60', 'logout cairn_twin', 'closeTab cairn_twin', 'close cairn_twin']);
    });

    test('a front check that throws is a warning, never the attempt\'s end', async () => {
        const { io, events } = fakeIO();
        io.front = async () => {
            throw new Error('CDP Page.bringToFront: websocket error');
        };
        const { h, fronts } = hooks(events);
        const r = await bracketAttempt(io, opts, h, { pollMs: 1 });
        expect(r.value).toBe('chain done');
        expect(fronts[0]!.ok).toBeNull();
        expect(fronts[0]!.warnings[0]).toContain('websocket error');
    });

    test('a failed probe still logs the gate account out and closes its window, and stands in the way', async () => {
        const { io, events } = fakeIO({ probeThrows: true });
        const r = await gateTabRead(io, 'cairn_twin', 60, 'before', { stage: 'cairn_smoke' });
        expect(events).toEqual(gateBefore);
        expect(gateTabProblems(r)).toEqual(['gate tab before: the probe failed: the page published no loops']);
    });

    test('an unconfirmed gate logout leaves the window (a closed tab is a client the server keeps in the world) and refuses', async () => {
        const { io, events } = fakeIO({ gateLogout: false });
        const r = await gateTabRead(io, 'cairn_twin', 60, 'before', { stage: 'cairn_smoke' });
        expect(events).toEqual(['open cairn_twin browser', 'probe cairn_twin 60', 'logout cairn_twin', 'close cairn_twin']);
        expect(gateTabProblems(r)[0]).toContain('the logout was not confirmed (still in game after timeout): cairn_twin may still be in the world');
    });

    test('a gate window that will not close (Chrome\'s last), a gate tab that does not open, no CDP: each stands in the way', async () => {
        const last = fakeIO({ closeThrows: "cairn_twin's window is Chrome's last" });
        expect(gateTabProblems(await gateTabRead(last.io, 'cairn_twin', 60, 'before'))).toEqual(["gate tab before: the window was not closed: cairn_twin's window is Chrome's last"]);
        const shut = fakeIO({ openThrows: 'cairn_twin' });
        expect(gateTabProblems(await gateTabRead(shut.io, 'cairn_twin', 60, 'before'))).toEqual(['gate tab before: the gate tab did not open: no in-game state within 120000 ms']);
        const bare = fakeIO();
        bare.io.closeTab = async () => null;
        expect(gateTabProblems(await gateTabRead(bare.io, 'cairn_twin', 60, 'before'))[0]).toContain('no CDP_URL');
    });

    test('no recording on the display before the login refuses; an unknown one does not', () => {
        expect(recordingProblems(recording(false))[0]).toContain('no recording on :10: start it before the attempt\'s login');
        expect(recordingProblems(recording(true))).toEqual([]);
        expect(recordingProblems({ display: null, on: null, why: 'no DISPLAY' })).toEqual([]);
    });
});

describe('attemptFront: the live-frame pass line', () => {
    const win = (name: string, id = '0x1'): XWindow => ({ id, name, types: ['NORMAL'], states: [] });
    const shows = (name: string): FrontWindows => ({ active: win(name), top: win(name), windows: 3 });
    const ours = shows('cairn_smoke - 2004Scape Bot Client');
    const gateWin = shows('cairn_twin - 2004Scape Bot Client');
    const frame = (match: boolean | null, n = 1): FrameCheck => ({ path: `f-${n}.png`, match, diff: match ? 3.2 : 41.5, at: { x: 0, y: 48 }, contrast: match === null ? 2 : 40, max: 12 });
    const tab = (o: Partial<TabFront> = {}): TabFront => ({
        title: 'cairn_smoke - 2004Scape Bot Client', focused: true, visibility: 'visible', viewport: { width: 1920, height: 978, dpr: 1 }, windowState: 'maximized', others: [], ...o,
    });

    function frontIO(looks: { w: FrontWindows; f: FrameCheck }[], o: Partial<FrontIO> = {}) {
        const calls: string[] = [];
        const ws = looks.map(l => l.w);
        const fs = looks.map(l => l.f);
        const io: FrontIO = {
            display: ':10',
            tab: async mark => {
                calls.push(`tab ${mark}`);
                return tab();
            },
            raise: async () => void calls.push('raise'),
            windows: async () => {
                calls.push('windows');
                return ws.shift()!;
            },
            frame: async n => {
                calls.push(`frame ${n}`);
                return fs.shift()!;
            },
            settle: async () => {},
            ...o,
        };
        return { io, calls };
    }

    test('in front, only window, maximised, and the frame shows it: PASS, nothing raised', async () => {
        const { io, calls } = frontIO([{ w: ours, f: frame(true) }]);
        const f = await attemptFront('cairn_smoke', io);
        expect(f.ok).toBe(true);
        expect(f.raised).toBe(false);
        expect(calls).toEqual(['tab cairn_smoke', 'windows', 'frame 1']);
        expect(frontLine(f)).toBe("live frame: PASS: cairn_smoke's tab is the only window, maximised and in front of :10; the frame shows it (difference 3.2 at 0,48; f-1.png)");
    });

    test('covered by the gate window: raised once, looked at again, PASS with the cover recorded', async () => {
        const { io, calls } = frontIO([{ w: gateWin, f: frame(false, 1) }, { w: ours, f: frame(true, 2) }]);
        const f = await attemptFront('cairn_smoke', io);
        expect(calls).toEqual(['tab cairn_smoke', 'windows', 'frame 1', 'raise', 'windows', 'frame 2']);
        expect(f.ok).toBe(true);
        expect(f.before?.windows?.top?.name).toBe('cairn_twin - 2004Scape Bot Client');
        expect(frontLine(f)).toContain('raised over "cairn_twin - 2004Scape Bot Client"');
    });

    test('the window is ours but the frame shows something else: raised, and FAIL if it still does', async () => {
        const { io, calls } = frontIO([{ w: ours, f: frame(false, 1) }, { w: ours, f: frame(false, 2) }]);
        const f = await attemptFront('cairn_smoke', io);
        expect(calls).toContain('raise');
        expect(f.ok).toBe(false);
        expect(f.warnings).toEqual(["the live frame of :10 does not show cairn_smoke's tab (difference 41.5 over 12), even after raising it: the recording shows something else"]);
        expect(frontLine(f)).toStartWith("live frame: FAIL for cairn_smoke's tab");
    });

    test('another page open, or a window not maximised, fails without a raise', async () => {
        const others = frontIO([{ w: ours, f: frame(true) }], { tab: async () => tab({ others: ['bot=cairn_twin'] }) });
        const a = await attemptFront('cairn_smoke', others.io);
        expect(a.ok).toBe(false);
        expect(a.warnings[0]).toBe("other pages are open on Chrome (bot=cairn_twin): the attempt's tab must be the only window");
        expect(others.calls).not.toContain('raise');
        const small = await attemptFront('cairn_smoke', frontIO([{ w: ours, f: frame(true) }], { tab: async () => tab({ windowState: 'normal' }) }).io);
        expect(small.warnings).toEqual(["cairn_smoke's window is normal, not maximised"]);
    });

    test('a name that only contains the account is not its mark', async () => {
        const twin = shows('cairn_smoke_2 - 2004Scape Bot Client');
        expect((await attemptFront('cairn_smoke', frontIO([{ w: twin, f: frame(true) }, { w: twin, f: frame(true) }]).io)).ok).toBe(false);
    });

    test('no display, no frame, or an inconclusive frame: UNVERIFIED (null), warned', async () => {
        const none = await attemptFront('cairn_smoke', frontIO([], { windows: null }).io);
        expect(none.ok).toBeNull();
        expect(none.warnings).toEqual(['no DISPLAY: what the display shows was not read']);
        expect(frontLine(none)).toStartWith("live frame: UNVERIFIED for cairn_smoke's tab");
        const broken = await attemptFront('cairn_smoke', frontIO([{ w: ours, f: frame(true) }], { frame: async () => { throw new Error('ffmpeg x11grab :10: exit 1'); } }).io);
        expect(broken.ok).toBeNull();
        expect(broken.warnings).toEqual(['the live frame could not be taken: ffmpeg x11grab :10: exit 1']);
        const flat = await attemptFront('cairn_smoke', frontIO([{ w: ours, f: frame(null) }]).io);
        expect(flat.ok).toBeNull();
        expect(flat.warnings[0]).toContain('inconclusive (contrast 2');
    });
});
