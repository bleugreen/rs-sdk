#!/usr/bin/env bun
// One single-skill rehearsal attempt, end to end (cairn://p/rs/147; the harness is rs/150).
//
//   bun speedrun/rehearse.ts --skill=<name|module.ts> --bot=<env name> [--to=99] [--client=browser|lite]
//       [--kit-from=<giver> --kit=<item:n,...>] [--technique=auto|knife|plain] [--skill-opt=<key>=<value> ...]
//       [--gate-bot=<gate account env>] [--gate-json=<file>] [--gate-probe-trials=60] [--probe-trials=0]
//       [--force-gate] [--from=<step name or index>] [--log=<file>] [--lab] [--insecure-query-login]
//
// A thin layer over runner/resume.ts runResumable (runSteps with resume from game state) and
// lib/session.ts. In order:
//
// 1. Off the clock, before the rehearsal account logs in: /playercount; the direct gate read
//    ((a)-(c), rs/96's CLI docs/speedrun/scripts/tickmanip-latency.ts run on the gate account with
//    --gate-bot, or the --json file it wrote with --gate-json); and the in-page probe on the gate
//    account's own tab (--gate-probe-trials, browser). Each is a `gate` header row in the tick log.
//    It refuses to start when (c) fails (an overrun period: wait and re-read), when the world does
//    not answer, or when a non-lab world has no direct read; --force-gate overrides.
// 2. It launches the rehearsal client and runs, under the watchdog (rs/101's policy: a wedged
//    client is logged out, never killed to log it out): speedrun/skills/start.ts (S00), an
//    optional in-page probe on this account (--probe-trials, on the clock), an optional kit
//    receive (S01: lib/trade.ts receiveFrom with `want`; on the lab, --kit alone uses ::give),
//    then the skill module's steps({to, technique, ...}).
// 3. logoutClean the moment the chain ends (a last step that logged out by itself is fine), the
//    session rows, the gate tab's after-probe, the public hiscore row against the log, a summary.
//
// Stop: the first Ctrl-C stops at the next logoutSafe boundary with logoutClean; a second logs
// out at once. SIGTERM (a `timeout` bound) logs out at once too. A re-run walks from game state
// (runResumable); --from overrides the first walk. Use the same --log so the hiscore check sees
// every session. Exit: 0 chain done, 3 refused by the gate, 4 stopped or paused (resume), 1 error.

import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { isAbsolute, join } from 'path';
import type { BotWorldState } from '../sdk/types';
import { DemoMonitor, demoOrigin, samplePlayerCount } from './lib/demo-status';
import { directDecision, type DirectVerdict, verdictText } from './lib/hostgate';
import { probeInPage, programStatus, type ProgramStatus } from './lib/programs';
import { reconnectAfterOutage, serverDownProbe } from './lib/reconnect';
import { type ClientKind, closeSession, loadBotEnv, logoutClean, type LogoutResult, openSession, ROOT, type Session, startWatchdog } from './lib/session';
import { formatReport, newRunId, report, type RowKind, type StepReport, TickLog, type TickRow } from './lib/ticks';
import { receiveFrom, type WantSpec } from './lib/trade';
import { tickMs, waitUntil } from './lib/wait';
import { DROP_STEP, RESUME_STEP, runResumable, sessionLink } from './runner/resume';
import { BOUNDARY_STEP, type Step } from './runner/step';
import { parsePlayer, type PlayerRow, playerPath, PoliteFetcher } from './tools/hiscore-scrape';

// ------------------------------------------------------------------ arguments

export class UsageError extends Error {
    override name = 'UsageError';
}

export interface KitItem {
    /** As ::give takes it: `rune_axe`. */
    debugName: string;
    /** Matched case-insensitively as a substring of the item's name: `rune axe`. */
    name: string;
    amount: number;
}

export type Technique = 'auto' | 'knife' | 'plain';

export interface RehearseArgs {
    /** A module under speedrun/skills (`woodcutting`) or a module path (`speedrun/runner/stub.ts`). */
    skill: string;
    bot: string;
    client: ClientKind;
    to: number;
    log?: string;
    lab: boolean;
    kitFrom?: string;
    kit?: KitItem[];
    technique?: Technique;
    skillOpts: Record<string, string>;
    gateBot?: string;
    gateJson?: string;
    /** In-page probe trials on the gate account's tab, before and after the attempt (off the clock). */
    gateProbeTrials: number;
    /** In-page probe trials on the rehearsal account after S00 (on its clock). */
    probeTrials: number;
    forceGate: boolean;
    from?: number | string;
}

const VALUE_FLAGS = new Set(['skill', 'bot', 'client', 'to', 'log', 'kit-from', 'kit', 'technique', 'skill-opt', 'gate-bot', 'gate-json', 'gate-probe-trials', 'probe-trials', 'from']);
// --insecure-query-login is read by lib/session.ts from process.argv (lab-only browser login).
const SWITCHES = new Set(['lab', 'force-gate', 'insecure-query-login']);

export const USAGE = `usage: bun speedrun/rehearse.ts --skill=<name|module.ts> --bot=<env name> [--to=99] [--client=browser|lite]
    [--kit-from=<giver> --kit=<item:n,...>] [--technique=auto|knife|plain] [--skill-opt=<key>=<value> ...]
    [--gate-bot=<gate account env>] [--gate-json=<file>] [--gate-probe-trials=60] [--probe-trials=0]
    [--force-gate] [--from=<step name or index>] [--log=<file>] [--lab] [--insecure-query-login]`;

function wholeNumber(key: string, raw: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || n < min || n > max) throw new UsageError(`--${key} must be a whole number from ${min} to ${max}, not "${raw}"`);
    return n;
}

/** Parse argv (without `bun` and the script). The bot may also come positionally, as lab.sh passes it. */
export function parseArgs(argv: readonly string[]): RehearseArgs {
    const v = new Map<string, string>();
    const skillOpts: Record<string, string> = {};
    const positional: string[] = [];
    for (const a of argv) {
        if (!a.startsWith('--')) {
            positional.push(a);
            continue;
        }
        const eq = a.indexOf('=');
        const key = eq < 0 ? a.slice(2) : a.slice(2, eq);
        const val = eq < 0 ? undefined : a.slice(eq + 1);
        if (SWITCHES.has(key)) {
            if (val !== undefined) throw new UsageError(`--${key} takes no value`);
            v.set(key, 'true');
            continue;
        }
        if (!VALUE_FLAGS.has(key)) throw new UsageError(`unknown option --${key}`);
        if (!val) throw new UsageError(`--${key} needs a value (--${key}=...)`);
        if (key === 'skill-opt') {
            const e = val.indexOf('=');
            if (e <= 0) throw new UsageError(`--skill-opt takes <key>=<value>, not "${val}"`);
            skillOpts[val.slice(0, e)] = val.slice(e + 1);
            continue;
        }
        if (v.has(key)) throw new UsageError(`--${key} given twice`);
        v.set(key, val);
    }
    if (positional.length > 1) throw new UsageError(`unexpected arguments: ${positional.slice(1).join(' ')}`);
    const flagBot = v.get('bot');
    if (flagBot && positional[0] && flagBot !== positional[0]) throw new UsageError(`two bots given: ${positional[0]} and --bot=${flagBot}`);
    const bot = flagBot ?? positional[0];
    if (!bot) throw new UsageError('--bot is required');
    const skill = v.get('skill');
    if (!skill) throw new UsageError('--skill is required');

    const client = v.get('client') ?? 'browser';
    if (client !== 'browser' && client !== 'lite') throw new UsageError(`--client must be browser or lite, not "${client}"`);
    const technique = v.get('technique');
    if (technique !== undefined && technique !== 'auto' && technique !== 'knife' && technique !== 'plain') throw new UsageError(`--technique must be auto, knife or plain, not "${technique}"`);
    const lab = v.has('lab');

    const kitFrom = v.get('kit-from');
    const kitSpec = v.get('kit');
    if (kitFrom && !kitSpec) throw new UsageError('--kit-from needs --kit=<item:n,...> (the trade\'s want)');
    if (kitSpec && !kitFrom && !lab) throw new UsageError('--kit without --kit-from gives the kit with ::give, which only the lab allows (--lab)');

    const gateBot = v.get('gate-bot');
    if (gateBot === bot) throw new UsageError('--gate-bot must be a separate gate account, never the rehearsal account (RUN-HOST.md step 6)');
    const gateProbeTrials = v.has('gate-probe-trials') ? wholeNumber('gate-probe-trials', v.get('gate-probe-trials')!, 0) : gateBot && client === 'browser' ? 60 : 0;
    if (gateProbeTrials > 0 && !gateBot) throw new UsageError('--gate-probe-trials runs on the gate account\'s tab: it needs --gate-bot');
    const probeTrials = v.has('probe-trials') ? wholeNumber('probe-trials', v.get('probe-trials')!, 0) : 0;
    if (probeTrials > 0 && client !== 'browser') throw new UsageError('--probe-trials needs --client=browser: the lite client hosts no in-page programs');

    const from = v.get('from');
    return {
        skill,
        bot,
        client,
        to: v.has('to') ? wholeNumber('to', v.get('to')!, 2, 99) : 99,
        lab,
        skillOpts,
        gateProbeTrials,
        probeTrials,
        forceGate: v.has('force-gate'),
        ...(v.has('log') ? { log: v.get('log')! } : {}),
        ...(kitFrom ? { kitFrom } : {}),
        ...(kitSpec ? { kit: parseKit(kitSpec) } : {}),
        ...(technique ? { technique: technique as Technique } : {}),
        ...(gateBot ? { gateBot } : {}),
        ...(v.has('gate-json') ? { gateJson: v.get('gate-json')! } : {}),
        ...(from !== undefined ? { from: /^\d+$/.test(from) ? Number(from) : from } : {}),
    };
}

// ------------------------------------------------------------------ kit (manifest entry 33)

/** `rune_axe:1,knife,feather:800`: debug names with `_` for spaces, amount default 1. */
export function parseKit(spec: string): KitItem[] {
    const out: KitItem[] = [];
    for (const part of spec.split(',').map(p => p.trim()).filter(Boolean)) {
        const m = /^([a-z0-9_]+)(?::(\d+))?$/i.exec(part);
        if (!m) throw new UsageError(`bad kit item "${part}": use item or item:n, a debug name with _ for spaces`);
        const debugName = m[1]!.toLowerCase();
        const amount = m[2] === undefined ? 1 : Number(m[2]);
        if (amount < 1) throw new UsageError(`kit item ${debugName}: the amount must be at least 1`);
        if (out.some(k => k.debugName === debugName)) throw new UsageError(`kit item ${debugName} is listed twice`);
        out.push({ debugName, name: debugName.replace(/_/g, ' '), amount });
    }
    if (!out.length) throw new UsageError('--kit is empty');
    return out;
}

/** The trade's `want`: the receiver accepts only an offer holding every kit item at its amount. */
export function kitWant(kit: readonly KitItem[]): WantSpec[] {
    return kit.map(k => ({ item: k.name, amount: k.amount }));
}

/**
 * Kit items short in the inventory, as `name have/want`. `strict: false` asks only that each item
 * is there at all: consumables (feathers, logs) run down once the skill starts, and a resumed
 * attempt must not try to receive the kit again.
 */
export function kitMissing(inventory: ReadonlyArray<{ name: string; count: number }>, kit: readonly KitItem[], opts: { strict?: boolean } = {}): string[] {
    const strict = opts.strict ?? true;
    return kit.flatMap(k => {
        const have = inventory.filter(i => i.name.toLowerCase().includes(k.name)).reduce((a, i) => a + i.count, 0);
        return have >= (strict ? k.amount : 1) ? [] : [`${k.name} ${have}/${k.amount}`];
    });
}

/** S01 for a rehearsal: receive the kit from `giver` (or ::give it on the lab). Transient: no `done`. */
export function kitStep(kit: readonly KitItem[], giver: string | undefined): Step<any> {
    return {
        name: 'S01 kit',
        preconditions: s => (s.inGame ? true : 'not in game'),
        run: async ({ sdk }) => {
            if (kitMissing(sdk.getState()!.inventory, kit, { strict: false }).length === 0) return;
            if (giver) {
                const r = await receiveFrom(sdk, giver, { want: kitWant(kit) });
                if (!r.ok) throw new Error(`kit from ${giver}: ${r.reason}`);
                return;
            }
            for (const k of kit) void sdk.sendSay(`::give ${k.debugName} ${k.amount}`);
            const w = await waitUntil(sdk, s => kitMissing(s.inventory, kit).length === 0, { maxTicks: Math.ceil(kit.length / 5) + 10 });
            if (!w.ok) throw new Error(`lab kit still short: ${kitMissing(sdk.getState()!.inventory, kit).join(', ')}`);
        },
        postconditions: s => {
            const m = kitMissing(s.inventory, kit, { strict: false });
            return m.length ? `kit missing: ${m.join(', ')}` : true;
        },
        logoutSafe: true,
    };
}

// ------------------------------------------------------------------ gate

export interface DirectRead {
    source: 'gate-bot' | 'gate-json';
    /** When the probe started (ISO), from the CLI's JSON. */
    takenAt: string | null;
    verdict: DirectVerdict | null;
    vantage: { ok: boolean; failures: string[]; connectP50: number | null; edge: string | null; players: number | null } | null;
    error?: string;
}

export interface InPageRead {
    /** `gate tab before`, `gate tab after`, `rehearsal tab`. */
    label: string;
    account: string;
    verdict: DirectVerdict;
    loopRateP10: number | null;
    at: string;
}

/** A direct read is used for at most this long after it was taken. */
export const GATE_MAX_AGE_MS = 10 * 60_000;

/** What tickmanip-latency.ts --path=direct --json writes. */
export function parseDirectJson(j: unknown, source: DirectRead['source']): DirectRead {
    const o = (j ?? {}) as { path?: string; startedUtc?: string; verdict?: DirectVerdict; vantage?: DirectRead['vantage'] };
    const base = { source, takenAt: o.startedUtc ?? null, vantage: o.vantage ?? null };
    if (o.path !== 'direct' || !o.verdict?.checks) return { ...base, verdict: null, error: 'not a tickmanip-latency.ts --path=direct --json file' };
    return { ...base, verdict: o.verdict };
}

/**
 * Why not to start, or [] to go. The rule (RUN-HOST.md step 6, rs/102): (c) failing on any read is
 * an overrun period, so wait and re-read rather than start into a burst. A world that does not
 * answer, a failed or stale direct read, or (off the lab) no direct read at all also refuse.
 * (a), (b) and (d) are printed with the verdicts but do not refuse here.
 */
export function gateRefusal(i: { direct: DirectRead | null; inPage: readonly InPageRead[]; players: number | null; local: boolean; now: number }): string[] {
    const out: string[] = [];
    if (!i.local && i.players === null) out.push('the world does not answer /playercount (down or restarting): wait for it');
    if (!i.direct) {
        if (!i.local) out.push('no direct gate read: pass --gate-bot=<gate account> or --gate-json=<file> (RUN-HOST.md step 6)');
    } else if (i.direct.error) {
        out.push(`direct gate read failed: ${i.direct.error}`);
    } else {
        const c = i.direct.verdict?.checks.find(k => k.id === 'c');
        if (c?.ok === false) out.push(`(c) ${c.value} catch-ups per minute over ${c.limit} on the direct read: an overrun period; wait and re-read`);
        const age = i.direct.takenAt ? i.now - Date.parse(i.direct.takenAt) : Number.NaN;
        if (i.direct.source === 'gate-json' && !(age <= GATE_MAX_AGE_MS)) {
            out.push(`the direct gate read is ${Number.isFinite(age) ? `${Math.round(age / 60_000)} min old` : 'undated'} (at most ${GATE_MAX_AGE_MS / 60_000} min)`);
        }
    }
    for (const r of i.inPage) {
        const c = r.verdict.checks.find(k => k.id === 'c');
        if (c?.ok === false) out.push(`(c) ${c.value} catch-ups per minute over ${c.limit} on the ${r.label} in-page probe: an overrun period; wait and re-read`);
    }
    return out;
}

// ------------------------------------------------------------------ trackers (fed every published state)

/** Per client session (lib/session.ts sessionId): first and last in-world tick seen. */
export class SessionClock {
    readonly sessions = new Map<number, { first: number; last: number }>();
    observe(sessionId: number, s: Pick<BotWorldState, 'tick' | 'inGame'>): void {
        if (!s.inGame) return;
        const e = this.sessions.get(sessionId);
        if (!e) this.sessions.set(sessionId, { first: s.tick, last: s.tick });
        else e.last = Math.max(e.last, s.tick);
    }
}

export interface ReachEvent {
    skill: string;
    level: number;
    tick: number;
}

/** Base-level gains in any skill, one event per level (a multi-level jump gives one per level). */
export class ReachTracker {
    private base: Map<string, number> | null = null;
    observe(s: Pick<BotWorldState, 'skills' | 'tick' | 'inGame'>): ReachEvent[] {
        if (!s.inGame || !s.skills?.length) return [];
        const now = new Map(s.skills.map(k => [k.name.toLowerCase(), k.baseLevel] as const));
        const prev = this.base;
        this.base = now;
        if (!prev) return [];
        const out: ReachEvent[] = [];
        for (const [skill, level] of now) {
            const p = prev.get(skill);
            if (p !== undefined) for (let l = p + 1; l <= level; l++) out.push({ skill, level: l, tick: s.tick });
        }
        return out;
    }
}

/** In-page program runs to log: each run once, at its end (done, fault, stopped, or replaced by the next). */
export class ProgramTracker {
    private last: ProgramStatus | null = null;
    private readonly logged = new Set<string>();
    private static key(st: ProgramStatus): string {
        return `${st.runId}@${st.startedTick}`;
    }
    observe(st: ProgramStatus | null): ProgramStatus[] {
        const out: ProgramStatus[] = [];
        const prev = this.last;
        if (prev && (!st || ProgramTracker.key(st) !== ProgramTracker.key(prev)) && !this.logged.has(ProgramTracker.key(prev))) {
            this.logged.add(ProgramTracker.key(prev));
            out.push(st && prev.phase === 'running' ? { ...prev, phase: 'replaced' } : prev);
        }
        if (st && st.phase !== 'running' && !this.logged.has(ProgramTracker.key(st))) {
            this.logged.add(ProgramTracker.key(st));
            out.push(st);
        }
        if (st) this.last = st;
        return out;
    }
    /** A run still going when the attempt ended. */
    flush(): ProgramStatus[] {
        const prev = this.last;
        if (!prev || this.logged.has(ProgramTracker.key(prev))) return [];
        this.logged.add(ProgramTracker.key(prev));
        return [prev];
    }
}

// ------------------------------------------------------------------ rows

export function annotation(
    log: Pick<TickLog, 'runId'>,
    account: string,
    kind: RowKind,
    step: string,
    f: { sessionId?: number; startTick?: number; endTick?: number; ok?: boolean; error?: string; meta?: Record<string, unknown>; crossedSession?: boolean }
): TickRow {
    const startTick = f.startTick ?? -1;
    const endTick = f.endTick ?? startTick;
    return {
        v: 1, kind, runId: log.runId, account, sessionId: f.sessionId ?? 0, step, startTick, endTick,
        ticks: startTick < 0 ? 0 : Math.max(0, endTick - startTick), wallMs: 0, ok: f.ok ?? true,
        ...(f.error ? { error: f.error } : {}), ...(f.meta ? { meta: f.meta } : {}), ...(f.crossedSession ? { crossedSession: true } : {}),
        tickMs: tickMs(), at: new Date().toISOString(),
    };
}

export function programRow(log: Pick<TickLog, 'runId'>, account: string, sessionId: number, st: ProgramStatus): TickRow {
    return annotation(log, account, 'program', `(program) ${st.name}`, {
        sessionId, startTick: st.startedTick, endTick: st.endedTick ?? st.tick, ok: st.phase !== 'fault', ...(st.fault ? { error: st.fault } : {}),
        meta: {
            runId: st.runId, phase: st.phase, params: st.params, counters: st.counters, gauges: st.gauges, packets: st.packets, deferred: st.deferred,
            skippedTicks: st.skippedTicks, maxTickMs: st.maxTickMs, frames: st.frames, publish: st.publish, react: st.react, loops: st.loops,
            ...(st.last ? { last: st.last } : {}), ...(st.result !== undefined ? { result: st.result } : {}),
        },
    });
}

// ------------------------------------------------------------------ summary

export interface Summary {
    sessions: { sessionId: number; ticks: number; playtime: number; lowerBound: boolean }[];
    /** Client tick 0 to the logout click, summed over the client sessions. */
    sessionTicks: number;
    /** What the server counts: each session's last in-world tick + 1 (hiscore-timestamps.md, recon row). */
    playtime: number;
    stepTicks: number;
    boundaryTicks: number;
    boundaries: number;
    /** The resume walk's own rows ((resume), (drop)). */
    runnerTicks: number;
    /** In the session but in no runner row: login to the first walk, and the end to the logout click. */
    outsideTicks: number;
    /** The session minus the step rows: every tick the steps themselves did not take. */
    overhead: number;
    overheadPerBoundary: number | null;
    steps: StepReport[];
    /** Every level gained, at the account's playtime (sessions before it, plus its client tick). */
    reach: { skill: string; level: number; playtime: number }[];
    lowerBound: boolean;
}

const sum = (rows: readonly TickRow[]) => rows.reduce((a, r) => a + r.ticks, 0);

/** The tick log's arithmetic. Rows in append order; a session row follows its own reach rows. */
export function summarize(rows: readonly TickRow[]): Summary {
    const sessions: Summary['sessions'] = [];
    const reach: Summary['reach'] = [];
    let prior = 0;
    for (const r of rows) {
        if (r.kind === 'session') {
            const playtime = r.endTick + 1;
            sessions.push({ sessionId: r.sessionId, ticks: r.ticks, playtime, lowerBound: r.crossedSession === true || r.meta?.ended === 'relaunch' });
            prior += playtime;
        } else if (r.kind === 'reach') {
            reach.push({ skill: String(r.meta?.skill), level: Number(r.meta?.level), playtime: prior + r.endTick });
        }
    }
    const plain = rows.filter(r => !r.kind);
    const boundary = plain.filter(r => r.step === BOUNDARY_STEP);
    const runner = plain.filter(r => r.step === RESUME_STEP || r.step === DROP_STEP);
    const stepRows = plain.filter(r => r.step !== BOUNDARY_STEP && r.step !== RESUME_STEP && r.step !== DROP_STEP);
    const sessionTicks = sessions.reduce((a, s) => a + s.ticks, 0);
    const stepTicks = sum(stepRows);
    const boundaryTicks = sum(boundary);
    const runnerTicks = sum(runner);
    const rep = report(stepRows);
    return {
        sessions,
        sessionTicks,
        playtime: sessions.reduce((a, s) => a + s.playtime, 0),
        stepTicks,
        boundaryTicks,
        boundaries: boundary.length,
        runnerTicks,
        outsideTicks: sessionTicks - stepTicks - boundaryTicks - runnerTicks,
        overhead: sessionTicks - stepTicks,
        overheadPerBoundary: boundary.length ? Math.round(((sessionTicks - stepTicks) / boundary.length) * 100) / 100 : null,
        steps: rep.steps,
        reach,
        lowerBound: rep.lowerBound || sessions.some(s => s.lowerBound),
    };
}

export interface HiscoreCheck {
    row: string;
    hiscore: number | null;
    expected: number | null;
    diff: number | null;
    ok: boolean | null;
    basis: string;
}

/** Manifest entry 0's demo acceptance: the hiscore playtime within 2 ticks of the log. */
export const HISCORE_TOLERANCE = 2;

function check(row: string, hiscore: number, expected: number | null, basis: string): HiscoreCheck {
    const diff = expected === null ? null : hiscore - expected;
    return { row, hiscore, expected, diff, ok: diff === null ? null : Math.abs(diff) <= HISCORE_TOLERANCE, basis };
}

/**
 * The public rows against the log (docs/speedrun/research/competitors/hiscore-timestamps.md): a
 * skill row carries the playtime its current level was reached at; Overall carries the largest
 * stamp, and the logout playtime while no level was ever gained (a fresh account's starting levels).
 */
export function compareHiscore(s: Summary, rows: readonly PlayerRow[] | null, skill: string): HiscoreCheck[] {
    if (!rows) return [{ row: 'player', hiscore: null, expected: null, diff: null, ok: null, basis: 'no player page (nothing written yet?)' }];
    const out: HiscoreCheck[] = [];
    const target = rows.find(r => r.skill.toLowerCase() === skill.toLowerCase());
    if (target) {
        if (target.level === null || target.ticks === null) {
            out.push({ row: target.skill, hiscore: null, expected: null, diff: null, ok: null, basis: 'no row (under level 15)' });
        } else {
            const at = [...s.reach].reverse().find(r => r.skill === skill.toLowerCase() && r.level === target.level);
            out.push(check(`${target.skill} ${target.level}`, target.ticks, at?.playtime ?? null, at ? `level ${target.level} reached in the log` : `level ${target.level} not reached in this log`));
        }
    }
    const overall = rows.find(r => r.category === 0);
    if (overall?.ticks != null) {
        if (s.reach.length) out.push(check('Overall', overall.ticks, Math.max(...s.reach.map(r => r.playtime)), 'the latest level gained in the log'));
        else out.push(check('Overall', overall.ticks, s.sessions.length ? s.playtime : null, 'logout playtime (no level gained)'));
    }
    return out;
}

export function formatSummary(
    s: Summary,
    o: { account: string; skill: string; to: number; outcome: string; gate: readonly string[]; hiscore: readonly HiscoreCheck[] | null; hiscoreUrl?: string }
): string {
    const lines: string[] = [];
    lines.push(`rehearsal ${o.account}: ${o.skill} to ${o.to}: ${o.outcome}`);
    for (const g of o.gate) lines.push(`gate: ${g}`);
    lines.push('');
    const reportRows = { steps: s.steps, totalTicks: s.stepTicks, lowerBound: s.lowerBound, annotations: [] };
    lines.push(formatReport(reportRows));
    lines.push('');
    const sess = s.sessions.map(x => `${x.ticks}${x.lowerBound ? ' (>=)' : ''}`).join(' + ');
    lines.push(`session: ${s.sessionTicks} ticks (${sess || 'none'}) -> playtime ${s.playtime} (each session's last tick + 1)`);
    lines.push(
        `  steps ${s.stepTicks}; boundaries ${s.boundaryTicks} over ${s.boundaries}; resume walk ${s.runnerTicks}; outside the runner ${s.outsideTicks} ` +
            `(login to the first step, the end to the logout click); overhead ${s.overhead}${s.overheadPerBoundary === null ? '' : ` = ${s.overheadPerBoundary} per boundary`}`
    );
    const target = [...s.reach].reverse().find(r => r.skill === o.skill.toLowerCase());
    if (target) lines.push(`reach: ${o.skill} ${target.level} at playtime ${target.playtime}`);
    if (o.hiscore) {
        for (const h of o.hiscore) {
            const mark = h.ok === null ? '' : h.ok ? ' ok' : ` OFF by ${h.diff}`;
            lines.push(`hiscore ${h.row}: ${h.hiscore ?? '-'} vs log ${h.expected ?? '-'}${h.diff === null ? '' : ` (${h.diff >= 0 ? '+' : ''}${h.diff})`}${mark}; ${h.basis}`);
        }
        if (o.hiscoreUrl) lines.push(`  ${o.hiscoreUrl}`);
    }
    return lines.join('\n');
}

// ------------------------------------------------------------------ the attempt

export interface SkillModule {
    skill: string;
    steps(opts?: { to?: number; technique?: Technique; [k: string]: unknown }): Step<any>[];
}

async function loadSkillModule(spec: string): Promise<SkillModule> {
    const path = spec.includes('/') || spec.endsWith('.ts') ? (isAbsolute(spec) ? spec : join(ROOT, spec)) : join(import.meta.dir, 'skills', `${spec}.ts`);
    if (!existsSync(path)) throw new UsageError(`no skill module at ${path}`);
    const m = (await import(path)) as Partial<SkillModule>;
    if (typeof m.skill !== 'string' || typeof m.steps !== 'function') throw new UsageError(`${path} does not export \`skill\` and \`steps()\``);
    return m as SkillModule;
}

const isLocalWorld = (server: string | undefined) => !server || server.startsWith('localhost') || server.startsWith('127.');

/** rs/96's CLI on the gate account, in its own process: it logs the account in on the engine websocket. */
async function directReadViaCli(gateBot: string, opts: { lab: boolean; runId: string }): Promise<DirectRead> {
    const dir = join(process.env.TMPDIR ?? '/tmp', 'speedrun');
    mkdirSync(dir, { recursive: true });
    const json = join(dir, `gate-${opts.runId}.json`);
    rmSync(json, { force: true });
    const args = ['bun', 'docs/speedrun/scripts/tickmanip-latency.ts', gateBot, '--path=direct', `--json=${json}`, ...(opts.lab ? [] : ['--no-tele'])];
    console.log(`[gate] ${args.join(' ')}`);
    const child = Bun.spawn(args, { cwd: ROOT, stdout: 'pipe', stderr: 'inherit' });
    const kill = setTimeout(() => child.kill('SIGTERM'), 15 * 60_000);
    const out = await new Response(child.stdout).text();
    const code = await child.exited;
    clearTimeout(kill);
    const said = out.split('\n').filter(l => /^(vantage|probe|latency|on time|tick|gate)/.test(l));
    for (const l of said) console.log(`[gate]   ${l}`);
    if (existsSync(json)) return parseDirectJson(JSON.parse(readFileSync(json, 'utf-8')), 'gate-bot');
    const why = said.find(l => l.startsWith('gate (direct)')) ?? `exit ${code}`;
    return { source: 'gate-bot', takenAt: new Date().toISOString(), verdict: null, vantage: null, error: why };
}

async function inPageRead(session: Session, trials: number, label: string): Promise<InPageRead> {
    const r = await probeInPage(session.sdk, { trials });
    const loopRateP10 = programStatus(session.sdk.getState())?.loops?.p10Last10s ?? null;
    const verdict = directDecision({ onTime: r.onTime, trials: r.trials, steadiness: r.steadiness, loopRateP10 });
    return { label, account: session.name, verdict, loopRateP10, at: new Date().toISOString() };
}

function gateLine(r: { label: string; verdict: DirectVerdict | null; error?: string }): string {
    return `${r.label}: ${r.verdict ? verdictText(r.verdict) : `no verdict (${r.error ?? 'unknown'})`}`;
}

async function readHiscore(account: string, origin: string, runId: string): Promise<PlayerRow[] | null> {
    // Rows are written at the clean logout and show about 3 s later (hiscore-timestamps.md).
    for (let attempt = 1; attempt <= 6; attempt++) {
        await Bun.sleep(5_000);
        const fetcher = new PoliteFetcher(join(ROOT, 'speedrun', 'runs', 'hiscore-cache', `rehearse-${runId}-${attempt}`), new Date(), origin);
        try {
            const rows = parsePlayer(await fetcher.get(playerPath(account)));
            if (rows) return rows;
        } catch (e) {
            console.error(`[hiscore] ${e instanceof Error ? e.message : e}`);
        }
    }
    return null;
}

async function main(argv: string[]): Promise<number> {
    const a = parseArgs(argv);
    const env = loadBotEnv(a.bot);
    const local = isLocalWorld(env.SERVER);
    if (a.lab && !local) throw new UsageError(`--lab accepts staff fixtures, and ${env.SERVER} is not a local lab`);
    const mod = await loadSkillModule(a.skill);
    const start = await import('./skills/start');
    const runId = newRunId();
    const log = TickLog.open(`rehearse-${mod.skill}-${runId}`, a.log);
    const account = env.BOT_USERNAME;
    const origin = demoOrigin(env.SERVER);
    console.log(`[rehearse] ${account}: ${mod.skill} to ${a.to} on ${env.SERVER ?? 'localhost'} (${a.client}); log ${log.path}`);

    // 1. The gate, off the clock.
    const players = (await samplePlayerCount(origin)).players;
    log.append(annotation(log, account, 'gate', '(gate) players', { meta: { players, origin } }));
    let direct: DirectRead | null = null;
    if (a.gateJson) direct = parseDirectJson(JSON.parse(readFileSync(a.gateJson, 'utf-8')), 'gate-json');
    else if (a.gateBot) direct = await directReadViaCli(a.gateBot, { lab: a.lab, runId });
    if (direct) log.append(annotation(log, account, 'gate', '(gate) direct', { ok: !direct.error && direct.verdict?.on === true, ...(direct.error ? { error: direct.error } : {}), meta: { ...direct, ...(direct.verdict ? { text: verdictText(direct.verdict) } : {}) } }));
    const inPage: InPageRead[] = [];
    let gateTab: Session | null = null;
    if (a.gateProbeTrials > 0) {
        gateTab = await openSession(a.gateBot!, { client: 'browser', launch: true });
        inPage.push(await inPageRead(gateTab, a.gateProbeTrials, 'gate tab before'));
        log.append(annotation(log, gateTab.name, 'gate', '(gate) in-page before', { meta: { ...inPage[0]!, text: verdictText(inPage[0]!.verdict) } }));
    }
    const gate = [
        `${players ?? '?'} players online`,
        ...(direct ? [gateLine({ label: `direct (${direct.source}, ${direct.takenAt ?? 'undated'})`, verdict: direct.verdict, ...(direct.error ? { error: direct.error } : {}) })] : []),
        ...inPage.map(r => gateLine(r)),
    ];
    for (const g of gate) console.log(`[gate] ${g}`);
    const refusal = gateRefusal({ direct, inPage, players, local, now: Date.now() });
    if (refusal.length) {
        if (!a.forceGate) {
            for (const r of refusal) console.error(`[rehearse] REFUSED: ${r}`);
            console.error('[rehearse] nothing was logged in for the attempt; re-read the gate and run again (or --force-gate)');
            if (gateTab) {
                await logoutClean(gateTab).catch(() => {});
                await closeSession(gateTab);
            }
            return 3;
        }
        for (const r of refusal) console.warn(`[rehearse] --force-gate: starting anyway: ${r}`);
    }

    // 2. The attempt, on the clock from the login.
    const session = await openSession(a.bot, { client: a.client, launch: true });
    const clock = new SessionClock();
    const reach = new ReachTracker();
    const programs = new ProgramTracker();
    let seenSession = session.sessionId;
    const closeSessionRow = (id: number, ended: 'logout' | 'relaunch', endTick?: number, logout?: LogoutResult) => {
        const e = clock.sessions.get(id);
        if (!e) return;
        const end = endTick ?? e.last;
        log.append(annotation(log, account, 'session', '(session)', { sessionId: id, startTick: 0, endTick: end, meta: { firstObservedTick: e.first, ended, ...(logout ? { logout } : {}) } }));
        clock.sessions.delete(id);
    };
    const unsubscribe = session.sdk.onStateUpdate(s => {
        if (session.sessionId !== seenSession) {
            closeSessionRow(seenSession, 'relaunch');
            seenSession = session.sessionId;
        }
        clock.observe(session.sessionId, s);
        for (const r of reach.observe(s)) log.append(annotation(log, account, 'reach', `(reach) ${r.skill} ${r.level}`, { sessionId: session.sessionId, startTick: r.tick, meta: { skill: r.skill, level: r.level } }));
        for (const st of programs.observe(programStatus(s))) log.append(programRow(log, account, session.sessionId, st));
    });
    const monitor = local ? null : new DemoMonitor(origin);
    const wd = startWatchdog(session, {
        onEvent: e => console.log(`[watchdog] ${e.verdict}: ${e.reason}`),
        ...(monitor ? { serverDown: serverDownProbe(monitor), actions: { reconnect: s => reconnectAfterOutage(s, { monitor }) } } : {}),
    });

    let lastLogout: LogoutResult | null = null;
    const leave = async (): Promise<LogoutResult> => {
        const r = await logoutClean(session);
        lastLogout = r;
        console.log(`[rehearse] logout: ${r.ok ? `out after the click on tick ${r.clickTick}` : `NOT confirmed (${r.reason})`}`);
        return r;
    };
    let stopAsked = false;
    let gateStop: string | null = null;
    let leaving: Promise<unknown> | null = null;
    const leaveNow = (code: number) => {
        if (leaving) return;
        console.error('[rehearse] logging out now');
        leaving = leave().finally(() => process.exit(code));
    };
    const onSigint = () => {
        if (stopAsked) return leaveNow(130);
        stopAsked = true;
        console.error('[rehearse] stop requested: logging out at the next logout-safe boundary (Ctrl-C again to log out now)');
    };
    // A browser tab outlives this process: on a `timeout` bound, leave the world before exiting.
    const onTerm = () => leaveNow(143);
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onTerm);
    process.on('SIGHUP', onTerm);

    const chain: Step<any>[] = [...start.steps()];
    if (a.probeTrials > 0) {
        chain.push({
            name: 'gate: in-page probe',
            preconditions: s => (s.inGame ? true : 'not in game'),
            run: async () => {
                const r = await inPageRead(session, a.probeTrials, 'rehearsal tab');
                inPage.push(r);
                log.append(annotation(log, account, 'gate', '(gate) in-page rehearsal', { meta: { ...r, text: verdictText(r.verdict) } }));
                console.log(`[gate] ${gateLine(r)}`);
                const why = gateRefusal({ direct: null, inPage: [r], players, local: true, now: Date.now() });
                if (why.length && !a.forceGate) gateStop = why.join('; ');
            },
            postconditions: () => true,
            logoutSafe: true,
        });
    }
    if (a.kit) chain.push(kitStep(a.kit, a.kitFrom));
    chain.push(...mod.steps({ to: a.to, ...(a.technique ? { technique: a.technique } : {}), ...a.skillOpts }));

    let outcome = 'chain done';
    let code = 0;
    try {
        const r = await runResumable(session, chain, {
            log,
            c: {},
            link: sessionLink(session),
            shouldStop: () => stopAsked || gateStop !== null,
            logout: () => leave(),
            ...(a.from !== undefined ? { from: a.from } : {}),
            onEvent: e => console.log(`[resume] ${JSON.stringify(e)}`),
        });
        if (r.resumeAt !== undefined) {
            outcome = gateStop ? `REFUSED after the in-page probe (${gateStop}); logged out` : `stopped before "${chain[r.resumeAt]?.name}"; logged out`;
            code = gateStop ? 3 : 4;
        } else if (r.drops) outcome = `chain done after ${r.drops} drop(s)`;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // A step that logged out on purpose (a PausedForPlayer pause) left the world itself.
        if (!session.expectInWorld) {
            outcome = `paused by the step, already logged out: ${msg}`;
            code = 4;
        } else {
            outcome = `FAILED: ${msg}`;
            code = 1;
        }
        console.error(`[rehearse] ${outcome}`);
    }

    // 3. Out of the world at once, then everything that costs no ticks.
    if (session.expectInWorld && !leaving) await leave();
    wd.stop();
    monitor?.stop();
    process.off('SIGINT', onSigint);
    for (const st of programs.flush()) log.append(programRow(log, account, session.sessionId, st));
    unsubscribe();
    const out = lastLogout as LogoutResult | null;
    // A step that logged out itself: its click was on the last in-world tick (logout latency 0).
    closeSessionRow(session.sessionId, 'logout', out?.ok ? out.lastInWorldTick : session.lastInWorldTick, out ?? undefined);

    if (gateTab) {
        try {
            const after = await inPageRead(gateTab, a.gateProbeTrials, 'gate tab after');
            log.append(annotation(log, gateTab.name, 'gate', '(gate) in-page after', { meta: { ...after, text: verdictText(after.verdict) } }));
            gate.push(gateLine(after));
        } catch (e) {
            gate.push(`gate tab after: failed (${e instanceof Error ? e.message : e})`);
        }
        await logoutClean(gateTab).catch(() => {});
        await closeSession(gateTab);
    }

    const summary = summarize(log.rows);
    let checks: HiscoreCheck[] | null = null;
    const hiscoreOrigin = local ? (process.env.HISCORES_WEB_PORT ? `http://localhost:${process.env.HISCORES_WEB_PORT}` : null) : origin;
    if (hiscoreOrigin && !session.expectInWorld) {
        checks = compareHiscore(summary, await readHiscore(account, hiscoreOrigin, runId), mod.skill);
        for (const c of checks) log.append(annotation(log, account, 'hiscore', `(hiscore) ${c.row}`, { ...(c.ok === false ? { ok: false } : {}), meta: { ...c } }));
    }
    console.log('\n' + formatSummary(summary, { account, skill: mod.skill, to: a.to, outcome, gate, hiscore: checks, ...(hiscoreOrigin ? { hiscoreUrl: `${hiscoreOrigin}${playerPath(account)}` } : {}) }));
    console.log(`log: ${log.path}`);
    if (code === 4) console.log('resume: run the same command again (the walk starts from game state); --from=<step> overrides it');
    await closeSession(session);
    return code;
}

if (import.meta.main) {
    try {
        process.exit(await main(process.argv.slice(2)));
    } catch (e) {
        if (e instanceof UsageError) {
            console.error(`${e.message}\n${USAGE}`);
            process.exit(2);
        }
        throw e;
    }
}
