#!/usr/bin/env bun
// One single-skill rehearsal attempt, end to end (cairn://p/rs/147; the harness is rs/150).
//
//   bun speedrun/rehearse.ts --skill=<name|module.ts> --bot=<env name> [--to=99] [--client=browser|lite]
//       [--kit-from=<giver> --kit=<item:n,...>] [--technique=auto|knife|plain] [--skill-opt=<key>=<value> ...]
//       [--gate-bot=<gate account env, default cairn_twin off a local world>] [--gate-json=<file>]
//       [--gate-probe-trials=60] [--probe-trials=0]
//       [--force-gate] [--from=<step name or index>] [--log=<file>] [--lab] [--insecure-query-login]
//       [--host-reservation=<file>] [--claim-owner=<rs/NNN>] [--kind=measurement|record]
//   bun speedrun/rehearse.ts --claim --bot=<env name> [--client=browser|lite] [--log=<file>] [--lab]
//       [--host-reservation=<file>] [--claim-owner=<rs/NNN>]
//
// --claim parks a fresh name: S00 (the tutorial skip that creates the account), then logoutClean,
// nothing else. It takes no gate account, no direct read and no probes, so it is one login, and
// it writes a `(gate) claim` row so the log says it was a claim and not an attempt.
//
// A thin layer over runner/resume.ts runResumable (runSteps with resume from game state) and
// lib/session.ts. In order:
//
// 0. Pre-flight: the host reservation (HOST.md, 'Run-capable twin'; $HOME/host-reserved.json, or
//    $SPEEDRUN_HOST_RESERVATION, or --host-reservation). While it is live, nothing logs in: exit 5.
//    It is read again before each login below, and at every logout-safe step boundary of the
//    attempt: a live one there logs out, writes a `(gate) paused for the gate/run` row, and exits 5.
//    The file is host's claim lock (`rs-claim take` writes it with the taker as owner), so
//    --claim-owner (or $SPEEDRUN_CLAIM_OWNER) names the claim the attempt runs under: that owner's
//    live claim is ours and blocks nothing, and ours gone stale is a warning. Any other live owner,
//    including host's preempt of ours (`displaced`), refuses at pre-flight and pauses at a boundary.
//    At each boundary the claim is also renewed with `rs-claim touch` in the background when
//    rs-claim is installed; its exit 3 (preempted) pauses at the next boundary.
// 1. Off the clock, before the rehearsal account logs in: /playercount; the direct gate read
//    ((a)-(c), rs/96's CLI docs/speedrun/scripts/tickmanip-latency.ts run on the gate account with
//    --gate-bot, or the --json file it wrote with --gate-json); the in-page probe on the gate
//    account's own tab (--gate-probe-trials, browser), in a session of its own that logs out, puts
//    the rehearsal account's bare window on the display and closes the gate's before the rehearsal
//    account logs in (bracketAttempt); and whether a recording runs on $DISPLAY. Each is a `gate`
//    header row in the tick log.
//    Off a local world the gate account is cairn_twin unless --gate-bot or --gate-json says otherwise.
//    It refuses to start when (c) fails (an overrun period: wait and re-read), when the world does
//    not answer, when a non-lab world has no direct read, when the gate tab's probe, logout or
//    window close failed, or when no recording runs on $DISPLAY; --force-gate overrides.
//    The attempt kind (--kind, default measurement) picks the direct read's rule: a measurement
//    refuses on (c) only; a record attempt (a fresh name raced once) also refuses below 58/60
//    next-tick reactions on a 60-trial direct read (tenet 12's (a) line), and takes no
//    --force-gate. A `(gate) kind` row records the kind, its rule and the read's (a) and (c).
// 2. It launches the rehearsal client and, beside its first steps, takes the live-frame pass line:
//    its tab is the only window, maximised and in front of $DISPLAY, and a frame grabbed as the
//    recording grabs shows its page (a `(gate) live frame` row; a warning, never a stop, when it
//    fails). It runs, under the watchdog (rs/101's policy: a wedged
//    client is logged out, never killed to log it out): speedrun/skills/start.ts (S00), an
//    optional in-page probe on this account (--probe-trials, on the clock), an optional kit
//    receive (S01: lib/trade.ts receiveFrom with `want`; on the lab, --kit alone uses ::give),
//    then the skill module's steps({to, technique, ...}).
//    /playercount is read every 10 minutes through the attempt and once after the logout (a
//    `players` row each; a background HTTP GET, no game packets).
// 3. logoutClean the moment the chain ends (a last step that logged out by itself is fine), the
//    session rows, a fresh gate session's after-probe once that logout is confirmed and the
//    recording on $DISPLAY has stopped, the public hiscore row against the log, a summary
//    (with a warning line when the player count swung by more than half: a demo restart and refill).
//
// Stop: the first Ctrl-C stops at the next logoutSafe boundary with logoutClean; a second logs
// out at once. SIGTERM (a `timeout` bound) logs out at once too. A re-run walks from game state
// (runResumable); --from overrides the first walk. Use the same --log so the hiscore check sees
// every session. Exit: 0 chain done, 3 refused by the gate, 4 stopped or paused (resume), 5 host
// reserved (refused at pre-flight, or paused for the gate/run; re-run once the reservation is gone),
// 1 error.

import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { homedir } from 'os';
import { basename, dirname, isAbsolute, join } from 'path';
import type { BotWorldState } from '../sdk/types';
import { clock, DemoMonitor, demoOrigin, samplePlayerCount } from './lib/demo-status';
import { directDecision, type DirectVerdict, verdictText } from './lib/hostgate';
import { probeInPage, programStatus, type ProgramStatus } from './lib/programs';
import { reconnectAfterOutage, serverDownProbe } from './lib/reconnect';
import {
    type FrameCheck, frameShows, type FrontWindows, frontWindows, grabFrame, type RecordingState, recordingState, type XWindow, xpropRunner,
} from './lib/display';
import { closeBotTabs, frontTab, raiseTabWindow, screenshotTab, stageBotTab, type TabClose, type TabFront, type TabStage, TITLE_MARK_SEPARATOR } from './lib/tab';
import { cdpUrl, type ClientKind, closeSession, loadBotEnv, logoutClean, type LogoutResult, openSession, ROOT, type Session, startWatchdog } from './lib/session';
import { formatReport, newRunId, parseLog, report, type RowKind, type StepReport, TickLog, type TickRow } from './lib/ticks';
import { receiveFrom, type WantSpec } from './lib/trade';
import { tickMs, waitUntil } from './lib/wait';
import { DROP_STEP, type Link, RESUME_STEP, type ResumeEvent, runResumable, sessionLink } from './runner/resume';
import { BOUNDARY_STEP, type Step } from './runner/step';
import { hasSave, parsePlayer, type PlayerRow, playerPath, PoliteFetcher, ROW_MIN_LEVEL, withServerRate } from './tools/hiscore-scrape';

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

/**
 * What the attempt is for, which picks the direct gate read's rule (gateRefusal). measurement:
 * a run that prices a method, refused on (c) only. record: a fresh name raced once, which must
 * not start on a failing minute, so it is also held to RECORD_LINE and cannot be forced.
 */
export type AttemptKind = 'measurement' | 'record';
export const ATTEMPT_KINDS: readonly AttemptKind[] = ['measurement', 'record'];
export const DEFAULT_ATTEMPT_KIND: AttemptKind = 'measurement';

export interface RehearseArgs {
    /** A module under speedrun/skills (`woodcutting`) or a module path (`speedrun/runner/stub.ts`); absent with --claim. */
    skill?: string;
    /** S00 then logout only: claims and parks a fresh name (no gate, no probes, no skill module). */
    claim: boolean;
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
    /** measurement (the default) or record; a claim carries the default and logs no kind. */
    kind: AttemptKind;
    from?: number | string;
    /** The host reservation file (default reservationPath()). */
    hostReservation?: string;
    /** The rs-claim owner the attempt runs under (resolved with claimOwner()). */
    claimOwner?: string;
}

const VALUE_FLAGS = new Set(['skill', 'bot', 'client', 'to', 'log', 'kit-from', 'kit', 'technique', 'skill-opt', 'gate-bot', 'gate-json', 'gate-probe-trials', 'probe-trials', 'from', 'host-reservation', 'claim-owner', 'kind']);
// --insecure-query-login is read by lib/session.ts from process.argv (lab-only browser login).
const SWITCHES = new Set(['lab', 'force-gate', 'insecure-query-login', 'claim']);
/** What --claim refuses: everything that would add a login, a probe or a step after S00. */
const NOT_WITH_CLAIM = ['skill', 'to', 'kit-from', 'kit', 'technique', 'skill-opt', 'gate-bot', 'gate-json', 'gate-probe-trials', 'probe-trials', 'force-gate', 'from', 'kind'];
/** The skill label a claim's log, summary and hiscore check carry. */
export const CLAIM_SKILL = 'claim';

/** The twin's gate account (rs/147): the gate tab and every direct gate read off a local world. */
export const DEFAULT_GATE_BOT = 'cairn_twin';

export const USAGE = `usage: bun speedrun/rehearse.ts --skill=<name|module.ts> --bot=<env name> [--to=99] [--client=browser|lite]
    [--kit-from=<giver> --kit=<item:n,...>] [--technique=auto|knife|plain] [--skill-opt=<key>=<value> ...]
    [--gate-bot=<gate account env, default ${DEFAULT_GATE_BOT} off a local world>] [--gate-json=<file>]
    [--gate-probe-trials=60] [--probe-trials=0]
    [--force-gate] [--from=<step name or index>] [--log=<file>] [--lab] [--insecure-query-login]
    [--host-reservation=<file>] [--claim-owner=<rs/NNN>] [--kind=measurement|record]
       bun speedrun/rehearse.ts --claim --bot=<env name> [--client=browser|lite] [--log=<file>] [--lab]
    [--host-reservation=<file>] [--claim-owner=<rs/NNN>]`;

function wholeNumber(key: string, raw: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || n < min || n > max) throw new UsageError(`--${key} must be a whole number from ${min} to ${max}, not "${raw}"`);
    return n;
}

/**
 * Parse argv (without `bun` and the script). The bot may also come positionally, as lab.sh passes it.
 * `defaultGateBot` is the gate account when neither --gate-bot nor --gate-json is given
 * (DEFAULT_GATE_BOT off a local world; none on the lab).
 */
export function parseArgs(argv: readonly string[], opts: { defaultGateBot?: string } = {}): RehearseArgs {
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
    const claim = v.has('claim');
    if (claim) {
        const extra = [...NOT_WITH_CLAIM.filter(k => v.has(k)), ...(Object.keys(skillOpts).length ? ['skill-opt'] : [])];
        if (extra.length) throw new UsageError(`--claim runs S00 and logs out, nothing else: drop --${extra.join(', --')}`);
    }
    const skill = v.get('skill');
    if (!skill && !claim) throw new UsageError('--skill is required (or --claim)');

    const client = v.get('client') ?? 'browser';
    if (client !== 'browser' && client !== 'lite') throw new UsageError(`--client must be browser or lite, not "${client}"`);
    const technique = v.get('technique');
    if (technique !== undefined && technique !== 'auto' && technique !== 'knife' && technique !== 'plain') throw new UsageError(`--technique must be auto, knife or plain, not "${technique}"`);
    const lab = v.has('lab');

    const kitFrom = v.get('kit-from');
    const kitSpec = v.get('kit');
    if (kitFrom && !kitSpec) throw new UsageError('--kit-from needs --kit=<item:n,...> (the trade\'s want)');
    if (kitSpec && !kitFrom && !lab) throw new UsageError('--kit without --kit-from gives the kit with ::give, which only the lab allows (--lab)');

    const gateBot = claim ? undefined : (v.get('gate-bot') ?? (v.has('gate-json') ? undefined : opts.defaultGateBot));
    if (gateBot === bot) throw new UsageError(`the gate account (${v.has('gate-bot') ? '--gate-bot' : 'the default'}, ${gateBot}) must be separate, never the rehearsal account (RUN-HOST.md step 6)`);
    const gateProbeTrials = v.has('gate-probe-trials') ? wholeNumber('gate-probe-trials', v.get('gate-probe-trials')!, 0) : gateBot && client === 'browser' ? 60 : 0;
    if (gateProbeTrials > 0 && !gateBot) throw new UsageError('--gate-probe-trials runs on the gate account\'s tab: it needs --gate-bot');
    const probeTrials = v.has('probe-trials') ? wholeNumber('probe-trials', v.get('probe-trials')!, 0) : 0;
    if (probeTrials > 0 && client !== 'browser') throw new UsageError('--probe-trials needs --client=browser: the lite client hosts no in-page programs');
    const kind = v.get('kind') ?? DEFAULT_ATTEMPT_KIND;
    if (!ATTEMPT_KINDS.includes(kind as AttemptKind)) throw new UsageError(`--kind must be ${ATTEMPT_KINDS.join(' or ')}, not "${kind}"`);
    if (kind === 'record' && v.has('force-gate')) {
        throw new UsageError('--force-gate cannot start a record attempt: a record starts only on a passing gate (drop --force-gate, or run --kind=measurement)');
    }

    const from = v.get('from');
    return {
        ...(skill ? { skill } : {}),
        claim,
        bot,
        client,
        to: v.has('to') ? wholeNumber('to', v.get('to')!, 2, 99) : 99,
        lab,
        skillOpts,
        gateProbeTrials,
        probeTrials,
        forceGate: v.has('force-gate'),
        kind: kind as AttemptKind,
        ...(v.has('log') ? { log: v.get('log')! } : {}),
        ...(kitFrom ? { kitFrom } : {}),
        ...(kitSpec ? { kit: parseKit(kitSpec) } : {}),
        ...(technique ? { technique: technique as Technique } : {}),
        ...(gateBot ? { gateBot } : {}),
        ...(v.has('gate-json') ? { gateJson: v.get('gate-json')! } : {}),
        ...(from !== undefined ? { from: /^\d+$/.test(from) ? Number(from) : from } : {}),
        ...(v.has('host-reservation') ? { hostReservation: v.get('host-reservation')! } : {}),
        ...(v.has('claim-owner') ? { claimOwner: v.get('claim-owner')! } : {}),
    };
}

// ------------------------------------------------------------------ kit (manifest entry 33)

/**
 * `rune_axe:1,knife,feather:800`: debug names with `_` for spaces, amount default 1. `item=n` is
 * the same, for speedrun/lab/lab.sh, which splits a script's arguments on `:`.
 */
export function parseKit(spec: string): KitItem[] {
    const out: KitItem[] = [];
    for (const part of spec.split(',').map(p => p.trim()).filter(Boolean)) {
        const m = /^([a-z0-9_]+)(?:[:=](\d+))?$/i.exec(part);
        if (!m) throw new UsageError(`bad kit item "${part}": use item, item:n or item=n, a debug name with _ for spaces`);
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
 * A record attempt's (a) line on the direct read (tenet 12): at least 58 of 60 trials reacted on
 * the next tick, calibrated at 58/60 with 17/17 agreement against (c) at most 2. 60/60 would
 * refuse good minutes. A read of more trials is held to the same share, rounded up; a shorter
 * read cannot show 58/60 and refuses.
 */
export const RECORD_LINE = { onTime: 58, trials: 60 } as const;

/** The on-time trials a record attempt needs from a direct read of `trials` trials. */
export function recordLineAt(trials: number): number {
    return Math.ceil((trials * RECORD_LINE.onTime) / RECORD_LINE.trials - 1e-9);
}

/** Why the record line refuses the direct read, by criterion; null when it holds. */
function recordLineRefusal(v: DirectVerdict | null): string | null {
    const line = `${RECORD_LINE.onTime}/${RECORD_LINE.trials}`;
    if (!v) return `record attempt: the direct gate read has no verdict, so the (a) record line (${line}) cannot be checked`;
    if (v.trials < RECORD_LINE.trials) return `record attempt: (a) the direct gate read ran ${v.trials} trials, under the ${RECORD_LINE.trials} the record line (${line}) is read on: re-read with --trials=${RECORD_LINE.trials} or more`;
    const at = recordLineAt(v.trials);
    if (v.onTime < at) return `record attempt: (a) ${v.onTime}/${v.trials} next-tick reactions on the direct read, under the record line of ${at}/${v.trials}: wait and re-read (or run it as --kind=measurement)`;
    return null;
}

/**
 * Why not to start, or [] to go. The rule (RUN-HOST.md step 6, rs/102): (c) failing on any read is
 * an overrun period, so wait and re-read rather than start into a burst. A world that does not
 * answer, a failed or stale direct read, or (off the lab) no direct read at all also refuse.
 * For a measurement, (a), (b) and (d) are printed with the verdicts but do not refuse here. A
 * record attempt (`kind: 'record'`) also refuses without a direct read, lab or not, and below
 * RECORD_LINE on it.
 */
export function gateRefusal(i: { direct: DirectRead | null; inPage: readonly InPageRead[]; players: number | null; local: boolean; now: number; claim?: boolean; kind?: AttemptKind }): string[] {
    const out: string[] = [];
    const record = i.kind === 'record';
    if (!i.local && i.players === null) out.push('the world does not answer /playercount (down or restarting): wait for it');
    if (!i.direct) {
        // A claim measures nothing, so it needs no gate read; a silent world still refuses it.
        if (record) out.push(`record attempt: no direct gate read to hold to the (a) record line (${RECORD_LINE.onTime}/${RECORD_LINE.trials}): pass --gate-bot=<gate account> or --gate-json=<file>`);
        else if (!i.local && !i.claim) out.push('no direct gate read: pass --gate-bot=<gate account> or --gate-json=<file> (RUN-HOST.md step 6)');
    } else if (i.direct.error) {
        out.push(`direct gate read failed: ${i.direct.error}`);
    } else {
        const c = i.direct.verdict?.checks.find(k => k.id === 'c');
        if (c?.ok === false) out.push(`(c) ${c.value} catch-ups per minute over ${c.limit} on the direct read: an overrun period; wait and re-read`);
        const a = record ? recordLineRefusal(i.direct.verdict) : null;
        if (a) out.push(a);
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

/** The `(gate) kind` row's meta: the attempt kind, the rule it ran under, and the direct read's (a) and (c). */
export interface KindGate {
    kind: AttemptKind;
    rule: string;
    /** (a) on the direct read; null without a read with a verdict. */
    onTime: number | null;
    trials: number | null;
    /** The on-time trials the record line needed on this read; null for a measurement or without a read. */
    recordLine: number | null;
    /** Whether the direct read held the record line (false without a usable read); null for a measurement. */
    recordHeld: boolean | null;
    /** Why it did not, by criterion. */
    recordShort?: string;
    /** (c) on the direct read. */
    catchUpsPerMinute: number | null;
    catchUpLimit: number | null;
}

export function kindGate(kind: AttemptKind, direct: DirectRead | null): KindGate {
    const v = direct?.verdict ?? null;
    const c = v?.checks.find(k => k.id === 'c') ?? null;
    const short = kind !== 'record' ? null : !direct ? 'record attempt: no direct gate read' : direct.error ? `record attempt: direct gate read failed: ${direct.error}` : recordLineRefusal(v);
    const rule =
        kind === 'record'
            ? `refuses below ${RECORD_LINE.onTime}/${RECORD_LINE.trials} next-tick reactions on the direct read, and on (c); no --force-gate`
            : 'refuses on (c) only';
    return {
        kind, rule,
        onTime: v?.onTime ?? null,
        trials: v?.trials ?? null,
        recordLine: kind === 'record' && v ? recordLineAt(Math.max(v.trials, RECORD_LINE.trials)) : null,
        recordHeld: kind === 'record' ? short === null : null,
        ...(short ? { recordShort: short } : {}),
        catchUpsPerMinute: c?.value ?? null,
        catchUpLimit: c?.limit ?? null,
    };
}

/** `kind: record (refuses below 58/60 ...); direct (a) 58/60, line 58 held; (c) 0/min, limit 2`, for the summary. */
export function kindText(g: KindGate): string {
    const read =
        g.onTime === null
            ? 'no direct read'
            : `direct (a) ${g.onTime}/${g.trials}${g.recordLine === null ? '' : `, line ${g.recordLine} ${g.recordHeld ? 'held' : 'SHORT'}`}; (c) ${g.catchUpsPerMinute === null ? 'not measured' : `${g.catchUpsPerMinute}/min`}, limit ${g.catchUpLimit ?? '?'}`;
    return `kind: ${g.kind} (${g.rule}); ${read}`;
}

// ------------------------------------------------------------------ host reservation

/**
 * The host reservation (docs/speedrun/rehearsals/HOST.md, 'Run-capable twin' and 'Claims'): one
 * JSON object `{"owner", "until", "reason"}`, which host's claim lock `rs-claim` writes for every
 * holder (it adds logins, what, taken, touched; a preempt makes host the owner and records the
 * holder it displaced under `displaced.owner`). It is live while `until` is in the future. While a
 * live one is not the attempt's own claim (claimOwner()), no attempt or claim starts, and an attempt
 * in flight logs out at its next logout-safe boundary and does not restart.
 */
export const RESERVATION_FILE = 'host-reserved.json';
/** Overrides the default path ($HOME/host-reserved.json); --host-reservation overrides both. */
export const RESERVATION_ENV = 'SPEEDRUN_HOST_RESERVATION';
/** Exit code: refused at pre-flight, or paused mid-attempt, because the host is reserved. */
export const EXIT_HOST_RESERVED = 5;
/** The `gate` annotation row an attempt paused by a live reservation writes. */
export const PAUSE_STEP = '(gate) paused for the gate/run';

/** The rs-claim owner the attempt runs under when --claim-owner is not given. */
export const CLAIM_OWNER_ENV = 'SPEEDRUN_CLAIM_OWNER';

export interface HostReservation {
    owner: string;
    until: string;
    reason: string;
    /** A preempt: the holder whose claim host's replaced (rs-claim's `displaced.owner`). */
    displaced?: string;
}

export type ReservationState =
    | { state: 'none' }
    | { state: 'expired'; reservation: HostReservation }
    | { state: 'live'; reservation: HostReservation }
    | { state: 'malformed'; error: string };

export function reservationPath(flag?: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
    return flag ?? env[RESERVATION_ENV] ?? join(env.HOME ?? homedir(), RESERVATION_FILE);
}

/** --claim-owner, else $SPEEDRUN_CLAIM_OWNER; undefined: the attempt runs under no claim of its own. */
export function claimOwner(flag?: string, env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
    const v = (flag ?? env[CLAIM_OWNER_ENV] ?? '').trim();
    return v || undefined;
}

/** The file's text (null: no file) at `now`. Malformed: not a JSON object, or an `until` that is not a time. */
export function judgeReservation(text: string | null, now: number): ReservationState {
    if (text === null) return { state: 'none' };
    let o: unknown;
    try {
        o = JSON.parse(text);
    } catch (e) {
        return { state: 'malformed', error: `not JSON (${e instanceof Error ? e.message : e})` };
    }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { state: 'malformed', error: 'not a JSON object' };
    const r = o as Record<string, unknown>;
    const until = typeof r.until === 'string' ? Date.parse(r.until) : Number.NaN;
    if (!Number.isFinite(until)) return { state: 'malformed', error: `"until" is not a time (${JSON.stringify(r.until ?? null)})` };
    const d = r.displaced as Record<string, unknown> | null | undefined;
    const displaced = d && typeof d === 'object' && typeof d.owner === 'string' ? d.owner : undefined;
    const reservation: HostReservation = { owner: String(r.owner ?? '?'), until: r.until as string, reason: String(r.reason ?? ''), ...(displaced ? { displaced } : {}) };
    return until > now ? { state: 'live', reservation } : { state: 'expired', reservation };
}

export function readReservation(path: string, now: number = Date.now()): ReservationState {
    let text: string | null;
    try {
        text = readFileSync(path, 'utf-8');
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return { state: 'malformed', error: `unreadable (${e instanceof Error ? e.message : e})` };
        text = null;
    }
    return judgeReservation(text, now);
}

export function reservationText(r: HostReservation): string {
    return `${r.owner} until ${r.until}${r.reason ? ` (${r.reason})` : ''}${r.displaced ? `, preempting ${r.displaced}` : ''}`;
}

/** One `rs-claim touch OWNER`: its exit code (null: it did not finish in time, or could not start) and output. */
export interface ClaimTouch {
    code: number | null;
    out: string;
}
export type ClaimToucher = (owner: string) => Promise<ClaimTouch>;
/** rs-claim's exit code for a touch by a holder host has preempted. */
export const TOUCH_PREEMPTED = 3;
export const TOUCH_TIMEOUT_MS = 10_000;
/** At most one touch per this, however close the boundaries fall. */
export const TOUCH_EVERY_MS = 60_000;

/** rs-claim on PATH, else $HOME/.local/bin/rs-claim, else null (not installed: nothing is touched). */
export function claimBin(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
    const onPath = env.PATH ? Bun.which('rs-claim', { PATH: env.PATH }) : null;
    if (onPath) return onPath;
    const home = join(env.HOME ?? homedir(), '.local', 'bin', 'rs-claim');
    return existsSync(home) ? home : null;
}

/** Runs `<bin> touch OWNER`, killed after `timeoutMs`. Never throws. */
export function claimToucher(bin: string, timeoutMs = TOUCH_TIMEOUT_MS): ClaimToucher {
    return async owner => {
        try {
            const p = Bun.spawn([bin, 'touch', owner], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
            const kill = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
            try {
                const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
                const text = `${out}${err}`.trim();
                return p.signalCode ? { code: null, out: text || `no answer in ${timeoutMs / 1000} s` } : { code: p.exitCode, out: text };
            } finally {
                clearTimeout(kill);
            }
        } catch (e) {
            return { code: null, out: `could not run ${bin}: ${e instanceof Error ? e.message : e}` };
        }
    };
}

/**
 * Reads the file afresh on every check; each distinct warning prints once. With `owner`, that
 * owner's claim is the attempt's own: live, it blocks nothing; stale, it warns and blocks nothing
 * (nobody else holds the machine). Any other live owner blocks, and a preempt of ours is host's.
 */
export class ReservationWatch {
    private readonly warned = new Set<string>();
    private touching: Promise<void> | null = null;
    private lastTouchAt = Number.NEGATIVE_INFINITY;
    private preempted: string | null = null;
    constructor(
        readonly path: string,
        private readonly opts: {
            now?: () => number;
            warn?: (msg: string) => void;
            /** The rs-claim owner the attempt runs under. */
            owner?: string;
            /** Renews the claim at boundaries (with `owner`); exit 3 is host's preempt. */
            touch?: ClaimToucher | null;
            touchEveryMs?: number;
        } = {}
    ) {}

    get owner(): string | undefined {
        return this.opts.owner;
    }

    private now(): number {
        return this.opts.now ? this.opts.now() : Date.now();
    }

    private warnOnce(key: string, msg: string): void {
        if (this.warned.has(key)) return;
        this.warned.add(key);
        (this.opts.warn ?? console.warn)(`[rehearse] WARNING: ${msg}`);
    }

    /** What keeps a login from starting now: a live reservation that is not our claim, or null. */
    check(): HostReservation | null {
        const s = readReservation(this.path, this.now());
        const owner = this.opts.owner;
        if (s.state === 'malformed') {
            this.warnOnce(`malformed:${s.error}`, `${this.path} is malformed, so it is not a live reservation: ${s.error}`);
            return null;
        }
        if (s.state === 'none') {
            if (owner) this.warnOnce('none', `no claim in ${this.path}, though the attempt runs under ${owner}'s: take it (rs-claim take ${owner} ...) before an attempt`);
            return null;
        }
        const r = s.reservation;
        const ours = owner !== undefined && r.owner === owner;
        if (s.state === 'expired') {
            if (ours) this.warnOnce(`stale:${r.until}`, `our claim went stale (${reservationText(r)}); nobody else holds the machine, so the attempt goes on: renew it (rs-claim touch ${owner}) or take it again`);
            return null;
        }
        return ours ? null : r;
    }

    /**
     * At a logout-safe step boundary: a preempt the last touch reported, else check(). While the
     * claim is ours it starts the next touch in the background (the runner's stop hook is
     * synchronous, and a touch can wait on rs-claim's lock), so its answer counts at a later boundary.
     */
    boundary(): HostReservation | null {
        if (this.preempted !== null) {
            const s = readReservation(this.path, this.now());
            if (s.state === 'live' && s.reservation.owner !== this.opts.owner) return s.reservation;
            return { owner: 'host', until: new Date(this.now()).toISOString(), reason: `rs-claim touch exited ${TOUCH_PREEMPTED}: ${this.preempted}`, ...(this.opts.owner ? { displaced: this.opts.owner } : {}) };
        }
        const r = this.check();
        if (!r) this.startTouch();
        return r;
    }

    /** Resolves once the touch in flight (if any) has been accounted for. */
    settled(): Promise<void> {
        return this.touching ?? Promise.resolve();
    }

    private startTouch(): void {
        const { owner, touch } = this.opts;
        if (!owner || !touch || this.touching) return;
        const t = this.now();
        if (t - this.lastTouchAt < (this.opts.touchEveryMs ?? TOUCH_EVERY_MS)) return;
        this.lastTouchAt = t;
        this.touching = touch(owner)
            .then(r => {
                if (r.code === TOUCH_PREEMPTED) this.preempted = r.out || 'PREEMPTED';
                else if (r.code !== 0) this.warnOnce(`touch:${r.code}:${r.out}`, `rs-claim touch ${owner} ${r.code === null ? 'did not answer' : `exited ${r.code}`}${r.out ? `: ${r.out}` : ''}; the claim file is still read at every boundary`);
            })
            .catch(e => this.warnOnce(`touch:${e}`, `rs-claim touch ${owner} failed: ${e instanceof Error ? e.message : e}`))
            .finally(() => {
                this.touching = null;
            });
    }
}

/** Pre-flight, and before each login: why nothing may log in, or null to go. */
export function reservationRefusal(watch: ReservationWatch): string | null {
    const r = watch.check();
    if (!r) return null;
    const whose = watch.owner ? (r.displaced === watch.owner ? `, which preempts our claim (${watch.owner})` : `, not our claim (${watch.owner})`) : '';
    return `the host is reserved by ${reservationText(r)} (${watch.path})${whose}: no attempt or claim starts while it is live; run again once it is gone or expired`;
}

// ------------------------------------------------------------------ player count through the attempt

/** /playercount is read this often during an attempt (rs/158). */
export const PLAYERS_EVERY_MS = 10 * 60_000;
/** A swing of more than this share of the attempt's highest count is a demo restart and refill. */
export const PLAYERS_MOVED_SHARE = 0.5;
export const GATE_PLAYERS_STEP = '(gate) players';

export interface PlayerRead {
    /** Wall ms. */
    at: number;
    /** null: /playercount did not answer. */
    players: number | null;
}

export interface PlayerSwing {
    reads: number;
    unanswered: number;
    first: PlayerRead | null;
    last: PlayerRead | null;
    min: PlayerRead | null;
    max: PlayerRead | null;
    /** (highest - lowest) / highest over the answered reads; 0 with no spread or a highest of 0. */
    swing: number;
    /** swing > PLAYERS_MOVED_SHARE. */
    moved: boolean;
}

/** The attempt's /playercount reads, in log order: the gate's read before the login and every `players` row. */
export function playerReads(rows: readonly TickRow[]): PlayerRead[] {
    return rows
        .filter(r => r.kind === 'players' || (r.kind === 'gate' && r.step === GATE_PLAYERS_STEP))
        .map(r => ({ at: Date.parse(typeof r.meta?.at === 'string' ? r.meta.at : r.at), players: typeof r.meta?.players === 'number' ? r.meta.players : null }));
}

export function playerSwing(reads: readonly PlayerRead[]): PlayerSwing {
    const answered = reads.filter((r): r is PlayerRead & { players: number } => r.players !== null);
    let min: (typeof answered)[number] | null = null;
    let max: (typeof answered)[number] | null = null;
    for (const r of answered) {
        if (!min || r.players < min.players) min = r;
        if (!max || r.players > max.players) max = r;
    }
    const swing = min && max && max.players > 0 ? (max.players - min.players) / max.players : 0;
    return {
        reads: reads.length, unanswered: reads.length - answered.length,
        first: answered[0] ?? null, last: answered[answered.length - 1] ?? null, min, max,
        swing, moved: swing > PLAYERS_MOVED_SHARE,
    };
}

export function formatPlayers(p: PlayerSwing): string[] {
    if (!p.reads) return [];
    const n = (r: PlayerRead | null) => (r?.players == null ? '?' : r.players.toLocaleString('en-US'));
    const at = (r: PlayerRead | null) => (r && Number.isFinite(r.at) ? ` (${clock(r.at)} PDT)` : '');
    const lines = [
        `players: ${n(p.first)} at the start, ${n(p.last)} at the end; lowest ${n(p.min)}${at(p.min)}, highest ${n(p.max)}${at(p.max)}; ` +
            `${p.reads} read${p.reads === 1 ? '' : 's'}${p.unanswered ? `, ${p.unanswered} unanswered` : ''}`,
    ];
    if (p.moved) {
        lines.push(
            `  MOVED ${Math.round(p.swing * 100)}% during the attempt (over ${PLAYERS_MOVED_SHARE * 100}%): a demo restart and refill; ` +
                'respawn-bound bands ran in two regimes, so price each at its own count'
        );
    }
    return lines;
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
    /** /playercount over the attempt: the gate read and the `players` rows. */
    players: PlayerSwing;
    /** Every pause for the gate/run in the log (PAUSE_STEP rows), this invocation's and earlier ones'. */
    pauses: { owner: string; until: string; reason: string; sessionId: number; tick: number; at: string; before: string | null }[];
    lowerBound: boolean;
}

const sum = (rows: readonly TickRow[]) => rows.reduce((a, r) => a + r.ticks, 0);

/** The tick log's arithmetic. Rows in append order; a session row follows its own reach rows. */
export function summarize(rows: readonly TickRow[]): Summary {
    const sessions: Summary['sessions'] = [];
    const reach: Summary['reach'] = [];
    const pauses: Summary['pauses'] = [];
    let prior = 0;
    for (const r of rows) {
        if (r.kind === 'session') {
            const playtime = r.endTick + 1;
            sessions.push({ sessionId: r.sessionId, ticks: r.ticks, playtime, lowerBound: r.crossedSession === true || r.meta?.ended === 'relaunch' });
            prior += playtime;
        } else if (r.kind === 'reach') {
            reach.push({ skill: String(r.meta?.skill), level: Number(r.meta?.level), playtime: prior + r.endTick });
        } else if (r.kind === 'gate' && r.step === PAUSE_STEP) {
            const m = r.meta ?? {};
            pauses.push({
                owner: String(m.owner ?? '?'), until: String(m.until ?? '?'), reason: String(m.reason ?? ''),
                sessionId: r.sessionId, tick: r.startTick, at: r.at, before: typeof m.before === 'string' ? m.before : null,
            });
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
        players: playerSwing(playerReads(rows)),
        pauses,
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
    /** The tick length the row's Time title stated or was converted under; absent for a plain `N ticks` title. */
    tickMs?: number;
}

/** Manifest entry 0's demo acceptance: the hiscore playtime within 2 ticks of the log. */
export const HISCORE_TOLERANCE = 2;

function check(row: string, hiscore: number, expected: number | null, basis: string, tickMs: number | undefined): HiscoreCheck {
    const diff = expected === null ? null : hiscore - expected;
    return { row, hiscore, expected, diff, ok: diff === null ? null : Math.abs(diff) <= HISCORE_TOLERANCE, basis, ...(tickMs === undefined ? {} : { tickMs }) };
}

/** The log's latest level gained in `skill`, with the playtime it was reached at. */
const lastReach = (s: Summary, skill: string): Summary['reach'][number] | undefined => [...s.reach].reverse().find(r => r.skill === skill.toLowerCase());

/**
 * Whether a player page shows this attempt's logout save, so that compareHiscore reads the rows the
 * log should match. Rows are written only by a save (docs/speedrun/research/competitors/hiscore-timestamps.md),
 * and the save lands when the player leaves the world, which a logout that wasn't confirmed can delay. Until
 * then the page is blank (no save yet: hasSave) or, on a resumed attempt, shows the earlier session's rows,
 * with the skill below the log's last level of it.
 */
export function hiscoreSettled(s: Summary, rows: readonly PlayerRow[] | null, skill: string): boolean {
    if (!rows || !hasSave(rows)) return false;
    const reached = lastReach(s, skill);
    if (!reached || reached.level < ROW_MIN_LEVEL) return true;
    const target = rows.find(r => r.skill.toLowerCase() === skill.toLowerCase());
    return target?.level != null && target.level >= reached.level;
}

/**
 * The public rows against the log (docs/speedrun/research/competitors/hiscore-timestamps.md): a
 * skill row carries the playtime its current level was reached at; Overall carries the largest
 * stamp, and the logout playtime while no level was ever gained (a fresh account's starting levels).
 */
export function compareHiscore(s: Summary, rows: readonly PlayerRow[] | null, skill: string): HiscoreCheck[] {
    if (!rows) return [{ row: 'player', hiscore: null, expected: null, diff: null, ok: null, basis: 'no player page (nothing written yet?)' }];
    if (!hasSave(rows)) return [{ row: 'player', hiscore: null, expected: null, diff: null, ok: null, basis: 'no rows saved yet (read before the logout save landed)' }];
    const out: HiscoreCheck[] = [];
    const target = rows.find(r => r.skill.toLowerCase() === skill.toLowerCase());
    if (target) {
        if (target.level === null || target.ticks === null) {
            const reached = lastReach(s, skill);
            const basis = reached && reached.level >= ROW_MIN_LEVEL ? `no row, though the log reached level ${reached.level} (read before this attempt's save landed)` : `no row (under level ${ROW_MIN_LEVEL})`;
            out.push({ row: target.skill, hiscore: null, expected: null, diff: null, ok: null, basis });
        } else {
            const at = [...s.reach].reverse().find(r => r.skill === skill.toLowerCase() && r.level === target.level);
            out.push(check(`${target.skill} ${target.level}`, target.ticks, at?.playtime ?? null, at ? `level ${target.level} reached in the log` : `level ${target.level} not reached in this log`, target.tickMs));
        }
    }
    const overall = rows.find(r => r.category === 0);
    if (overall?.ticks != null) {
        if (s.reach.length) out.push(check('Overall', overall.ticks, Math.max(...s.reach.map(r => r.playtime)), 'the latest level gained in the log', overall.tickMs));
        else out.push(check('Overall', overall.ticks, s.sessions.length ? s.playtime : null, 'logout playtime (no level gained)', overall.tickMs));
    }
    return out;
}

export function formatSummary(
    s: Summary,
    o: { account: string; skill: string; to?: number; outcome: string; gate: readonly string[]; hiscore: readonly HiscoreCheck[] | null; hiscoreUrl?: string }
): string {
    const lines: string[] = [];
    lines.push(`rehearsal ${o.account}: ${o.skill}${o.to === undefined ? '' : ` to ${o.to}`}: ${o.outcome}`);
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
    const target = lastReach(s, o.skill);
    if (target) lines.push(`reach: ${o.skill} ${target.level} at playtime ${target.playtime}`);
    lines.push(...formatPlayers(s.players));
    for (const p of s.pauses) {
        lines.push(
            `PAUSED for the gate/run at ${p.at}: host reserved by ${reservationText(p)}; logged out at tick ${p.tick} of session ${p.sessionId}` +
                (p.before ? `, before "${p.before}"` : '')
        );
    }
    if (o.hiscore) {
        for (const h of o.hiscore) {
            const mark = h.ok === null ? '' : h.ok ? ' ok' : ` OFF by ${h.diff}`;
            const rate = h.tickMs === undefined ? '' : ` at ${h.tickMs} ms/tick`;
            lines.push(`hiscore ${h.row}: ${h.hiscore ?? '-'}${rate} vs log ${h.expected ?? '-'}${h.diff === null ? '' : ` (${h.diff >= 0 ? '+' : ''}${h.diff})`}${mark}; ${h.basis}`);
        }
        if (o.hiscoreUrl) lines.push(`  ${o.hiscoreUrl}`);
    }
    return lines.join('\n');
}

// ------------------------------------------------------------------ the chain under its stops

export interface AttemptOptions {
    log: TickLog;
    account: string;
    link: Link;
    from?: number | string;
    /** Read at every logout-safe boundary (ReservationWatch.boundary), before the other stops. */
    reservation: ReservationWatch;
    /** Ctrl-C asked for a stop. */
    stopAsked: () => boolean;
    /** Why the rehearsal tab's in-page probe refuses ((c) failed), or null. */
    gateStop: () => string | null;
    /** Leave the world: logoutClean, page-confirmed. Clearing `expectInWorld` keeps the watchdog from relaunching. */
    logout: () => Promise<LogoutResult>;
    onEvent?: (e: ResumeEvent) => void;
}

export interface AttemptResult {
    outcome: string;
    code: number;
    /** Set when a live host reservation stopped the attempt. */
    paused: HostReservation | null;
}

/**
 * The chain through runResumable with the attempt's stops, polled after each logoutSafe step:
 * the runner has no safe point inside a step, so a long step runs to its end first. A live host
 * reservation logs out there, writes a PAUSE_STEP row and returns EXIT_HOST_RESERVED; nothing here
 * restarts the attempt. Ctrl-C returns 4 and a failed rehearsal-tab gate 3, as before.
 */
export async function runAttempt(session: Session, chain: ReadonlyArray<Step<any>>, o: AttemptOptions): Promise<AttemptResult> {
    const held: { reservation: HostReservation | null; logout: LogoutResult | null } = { reservation: null, logout: null };
    try {
        const r = await runResumable(session, chain, {
            log: o.log,
            c: {},
            link: o.link,
            // The reservation is read first, at every boundary, so a pause is recorded as one even beside a Ctrl-C.
            shouldStop: () => {
                held.reservation ??= o.reservation.boundary();
                return held.reservation !== null || o.stopAsked() || o.gateStop() !== null;
            },
            logout: async () => {
                held.logout = await o.logout();
            },
            ...(o.from !== undefined ? { from: o.from } : {}),
            ...(o.onEvent ? { onEvent: o.onEvent } : {}),
        });
        if (r.resumeAt === undefined) return { outcome: r.drops ? `chain done after ${r.drops} drop(s)` : 'chain done', code: 0, paused: null };
        const before = chain[r.resumeAt]?.name ?? null;
        const res = held.reservation;
        if (res) {
            const out = held.logout;
            o.log.append(annotation(o.log, o.account, 'gate', PAUSE_STEP, {
                sessionId: session.sessionId,
                startTick: out ? out.clickTick : (session.sdk.getState()?.tick ?? -1),
                ok: out?.ok === true,
                ...(out && !out.ok ? { error: `logout not confirmed: ${out.reason}` } : {}),
                meta: { ...res, path: o.reservation.path, before, ...(out ? { logout: out } : {}) },
            }));
            const left = out?.ok ? 'logged out' : `logout NOT confirmed (${out?.reason ?? 'no logout'})`;
            return {
                outcome: `PAUSED for the gate/run: the host is reserved by ${reservationText(res)}; ${left} before "${before}"; run again once the reservation is gone`,
                code: EXIT_HOST_RESERVED,
                paused: res,
            };
        }
        const gate = o.gateStop();
        if (gate) return { outcome: `REFUSED after the in-page probe (${gate}); logged out`, code: 3, paused: null };
        return { outcome: `stopped before "${before}"; logged out`, code: 4, paused: null };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // A step that logged out on purpose (a PausedForPlayer pause) left the world itself.
        const r = !session.expectInWorld ? { outcome: `paused by the step, already logged out: ${msg}`, code: 4 } : { outcome: `FAILED: ${msg}`, code: 1 };
        console.error(`[rehearse] ${r.outcome}`);
        return { ...r, paused: null };
    }
}

// ------------------------------------------------------------------ the gate tab and the attempt's window
//
// Every tab on the host's Chrome is a window on its one X display, and the recording grabs the
// display whole. Main's run-night ruling (cairn://p/rs/host, 2026-10-21 18:16 PDT), which rows
// follow too: the gate's probe tab is logged out and its window closed before the attempt logs in;
// the attempt's tab is the only browser window on the recorded display, maximised; the recording
// runs before the attempt's login, and a live frame of it in the attempt's first seconds is a
// pass line of the gate; and no other window comes up on that display until the attempt ends and
// the recording has stopped.

export interface TabIO {
    /** openSession with a launch: logs the account in and waits for an advancing tick. */
    open(bot: string, client: ClientKind): Promise<Session>;
    probe(s: Session, trials: number, label: string): Promise<InPageRead>;
    logout(s: Session): Promise<LogoutResult>;
    /** Put this account's client window on the display, logged out, maximised (lib/tab.ts stageBotTab); null without CDP. */
    stage(bot: string): Promise<TabStage | null>;
    /** Close the account's tabs (lib/tab.ts closeBotTabs); null without CDP. */
    closeTab(s: Session): Promise<TabClose | null>;
    /** closeSession: disconnects the SDK. */
    close(s: Session): Promise<void>;
    /** Bring the attempt's tab to the front and check what the display shows (attemptFront). */
    front(s: Session): Promise<FrontReport>;
    /** Whether a recording runs on the display (lib/display.ts recordingState). */
    recording(): Promise<RecordingState>;
    pause(ms: number): Promise<void>;
}

export interface GateTabRead {
    when: 'before' | 'after';
    label: string;
    account: string;
    read: InPageRead | null;
    error?: string;
    logout: LogoutResult | null;
    /** The attempt's window, staged before the gate's closes (before the attempt only). */
    staged?: TabStage | null;
    stageError?: string;
    tab: TabClose | null;
    tabError?: string;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * One in-page probe on the gate account's tab, in a session of its own: log in, probe, log out,
 * then (only after a confirmed logout: a closed tab is a dropped client, which the server keeps in
 * the world) stage `opts.stage`'s window and close the gate's, disconnect, and only then return.
 * Staging first keeps Chrome up, since it quits with its last window.
 */
export async function gateTabRead(io: TabIO, bot: string, trials: number, when: GateTabRead['when'], opts: { stage?: string } = {}): Promise<GateTabRead> {
    const label = `gate tab ${when}`;
    let s: Session;
    try {
        s = await io.open(bot, 'browser');
    } catch (e) {
        return { when, label, account: bot, read: null, error: `the gate tab did not open: ${message(e)}`, logout: null, tab: null };
    }
    const out: GateTabRead = { when, label, account: s.name, read: null, logout: null, tab: null };
    try {
        try {
            out.read = await io.probe(s, trials, label);
        } catch (e) {
            out.error = `the probe failed: ${message(e)}`;
        }
        out.logout = await io.logout(s).catch(e => ({ ok: false, clickTick: -1, lastInWorldTick: -1, latencyTicks: 0, wallMs: 0, reason: message(e) }));
        if (out.logout.ok) {
            if (opts.stage) {
                try {
                    out.staged = await io.stage(opts.stage);
                } catch (e) {
                    out.stageError = message(e);
                }
            }
            try {
                out.tab = await io.closeTab(s);
            } catch (e) {
                out.tabError = message(e);
            }
        }
    } finally {
        await io.close(s);
    }
    return out;
}

/** What in a gate tab read stands in the way: before the attempt each one refuses it. */
export function gateTabProblems(r: GateTabRead): string[] {
    const out: string[] = [];
    if (r.error) out.push(`${r.label}: ${r.error}`);
    if (r.logout && !r.logout.ok) out.push(`${r.label}: the logout was not confirmed (${r.logout.reason ?? 'unknown'}): ${r.account} may still be in the world, and its window is still open`);
    if (r.stageError) out.push(`${r.label}: the attempt's window could not be put on the display: ${r.stageError}`);
    if (r.tabError) out.push(`${r.label}: the window was not closed: ${r.tabError}`);
    if (r.logout?.ok && !r.tab && !r.tabError) out.push(`${r.label}: no CDP_URL, so the window was not closed and can cover the attempt's`);
    return out;
}

/** A recording problem before the attempt's login (RUN-HOST.md step 5): none running on the display. */
export function recordingProblems(r: RecordingState): string[] {
    return r.on === false ? [`no recording on ${r.display}: start it before the attempt's login (RUN-HOST.md step 5), so the video opens on the attempt's tab`] : [];
}

/** What the display showed at one look: the window in front and the live frame. */
export interface FrontLook {
    windows: FrontWindows | null;
    frame: FrameCheck | null;
}

export interface FrontReport {
    /** The gate's pass line: true passes, false fails, null could not be read. */
    ok: boolean | null;
    /** The account name the tab's title carries (lib/tab.ts frontTab). */
    mark: string;
    display: string | null;
    tab: TabFront | null;
    /** The last look (after the raise, when one was needed). */
    windows: FrontWindows | null;
    frame: FrameCheck | null;
    /** The first look, when it failed and the window was raised. */
    before?: FrontLook;
    raised: boolean;
    warnings: string[];
}

export interface FrontIO {
    display: string | null;
    tab(mark: string): Promise<TabFront | null>;
    raise(): Promise<void>;
    /** Null: no display to read (no DISPLAY in the environment). */
    windows: (() => Promise<FrontWindows>) | null;
    /** A live frame of the display, matched against the tab's own render; `n` numbers the look. */
    frame: ((n: number) => Promise<FrameCheck>) | null;
    /** Lets the window manager and Chrome apply the last change before the display is read. */
    settle(): Promise<void>;
}

const carriesMark = (w: XWindow | null | undefined, mark: string) => !!w && w.name.startsWith(mark + TITLE_MARK_SEPARATOR);

/**
 * The gate's pass line for the recording, in the attempt's first seconds: the attempt's tab is the
 * window in front of the display, a live frame grabbed as the recording grabs shows its page, it is
 * the only page on Chrome, and its window is maximised. When the window or the frame shows
 * something else, the tab is raised once and looked at again. It never throws: what it could not
 * do or read goes into `warnings`.
 */
export async function attemptFront(mark: string, d: FrontIO): Promise<FrontReport> {
    const r: FrontReport = { ok: null, mark, display: d.display, tab: null, windows: null, frame: null, raised: false, warnings: [] };
    try {
        r.tab = await d.tab(mark);
        if (!r.tab) r.warnings.push(`no tab for ${mark} on Chrome's DevTools port`);
    } catch (e) {
        r.warnings.push(`the tab could not be brought to the front: ${message(e)}`);
    }
    if (!d.windows) {
        r.warnings.push('no DISPLAY: what the display shows was not read');
        return r;
    }
    const look = async (n: number): Promise<FrontLook> => {
        await d.settle();
        const l: FrontLook = { windows: null, frame: null };
        try {
            l.windows = await d.windows!();
        } catch (e) {
            r.warnings.push(`the display could not be read: ${message(e)}`);
        }
        if (d.frame) {
            try {
                l.frame = await d.frame(n);
            } catch (e) {
                r.warnings.push(`the live frame could not be taken: ${message(e)}`);
            }
        } else r.warnings.push('no live frame: it can only be grabbed with a display');
        return l;
    };
    const covered = (l: FrontLook) => (l.windows !== null && !carriesMark(l.windows.top, mark)) || l.frame?.match === false;
    let l = await look(1);
    if (covered(l)) {
        r.before = l;
        try {
            await d.raise();
            r.raised = true;
        } catch (e) {
            r.warnings.push(`the window could not be raised: ${message(e)}`);
        }
        l = await look(2);
    }
    r.windows = l.windows;
    r.frame = l.frame;
    const after = r.raised ? ', even after raising it' : '';
    const fails: string[] = [];
    if (l.windows && !carriesMark(l.windows.top, mark)) fails.push(`the window in front of ${d.display} is "${l.windows.top?.name ?? 'none'}", not ${mark}'s tab${after}`);
    if (l.frame?.match === false) fails.push(`the live frame of ${d.display} does not show ${mark}'s tab (difference ${l.frame.diff} over ${l.frame.max})${after}: the recording shows something else`);
    if (r.tab && r.tab.others.length > 0) fails.push(`other pages are open on Chrome (${r.tab.others.join(', ')}): the attempt's tab must be the only window`);
    if (r.tab && r.tab.windowState !== 'maximized') fails.push(`${mark}'s window is ${r.tab.windowState}, not maximised`);
    if (l.frame?.match === null) r.warnings.push(`the live frame is inconclusive (contrast ${l.frame.contrast}${l.frame.diff === null ? ', the page is larger than the display' : ''})`);
    r.warnings.push(...fails);
    r.ok = fails.length > 0 ? false : !l.windows || !l.frame || l.frame.match === null || !r.tab ? null : true;
    return r;
}

export function frontLine(f: FrontReport): string {
    if (f.ok) {
        const raised = f.raised ? `; raised over "${f.before?.windows?.top?.name ?? 'none'}"` : '';
        return `live frame: PASS: ${f.mark}'s tab is the only window, maximised and in front of ${f.display}; the frame shows it (difference ${f.frame?.diff} at ${f.frame?.at?.x},${f.frame?.at?.y}; ${f.frame?.path})${raised}`;
    }
    return `live frame: ${f.ok === false ? 'FAIL' : 'UNVERIFIED'} for ${f.mark}'s tab: ${f.warnings.join('; ')}`;
}

export interface Refusal {
    code: number;
    reasons: string[];
}

export interface Bracketed<T> {
    before: GateTabRead | null;
    /** The display's recording, read right before the attempt's login. */
    recording: RecordingState;
    refused: Refusal | null;
    session?: Session;
    value?: T;
    front?: FrontReport;
    after: GateTabRead | null;
    afterSkipped?: string;
}

/** How long the after-probe waits for the recording to stop before it gives up on the probe. */
export const RECORDING_WAIT_MS = 10 * 60_000;

/**
 * The order that keeps the gate account off the attempt's recording: the gate tab's probe runs and
 * its session ends (logged out, the attempt's window staged, the gate's closed) before the attempt
 * logs in; the attempt's front check runs beside its first steps; and a fresh gate session probes
 * again only once the attempt's logout is confirmed and the recording has stopped, so the video
 * ends on the attempt. One of the attempt's accounts is in the world at a time.
 */
export async function bracketAttempt<T>(
    io: TabIO,
    o: { gateBot?: string; gateProbeTrials: number; bot: string; client: ClientKind },
    h: {
        gate(r: GateTabRead): void;
        /** Why not to start, given the gate tab's read and the display's recording; null to go. */
        refusal(before: GateTabRead | null, recording: RecordingState): Refusal | null;
        front(f: FrontReport, s: Session): void;
        attempt(s: Session): Promise<{ value: T; loggedOut: boolean; skipAfter?: string }>;
        /** The after-probe has begun waiting for the recording to stop. */
        waiting?(r: RecordingState): void;
    },
    opts: { recordingWaitMs?: number; pollMs?: number } = {}
): Promise<Bracketed<T>> {
    const probing = o.gateBot !== undefined && o.gateProbeTrials > 0;
    const before = probing ? await gateTabRead(io, o.gateBot!, o.gateProbeTrials, 'before', o.client === 'browser' ? { stage: o.bot } : {}) : null;
    if (before) h.gate(before);
    const recording = await io.recording();
    const refused = h.refusal(before, recording);
    if (refused) return { before, recording, refused, after: null };

    const session = await io.open(o.bot, o.client);
    const failed = (e: unknown): FrontReport => ({ ok: null, mark: session.name, display: null, tab: null, windows: null, frame: null, raised: false, warnings: [`the front check failed: ${message(e)}`] });
    // Beside the attempt, not before it: the account is in the world and its clock is running.
    const front = io.front(session).catch(failed).then(f => {
        h.front(f, session);
        return f;
    });
    const { value, loggedOut, skipAfter } = await h.attempt(session);
    const f = await front;
    const done = { before, recording, refused, session, value, front: f };
    if (!probing) return { ...done, after: null };
    if (!loggedOut) return { ...done, after: null, afterSkipped: `${session.name}'s logout was not confirmed, so the gate account stays out` };
    if (skipAfter) return { ...done, after: null, afterSkipped: skipAfter };

    const waitMs = opts.recordingWaitMs ?? RECORDING_WAIT_MS;
    const until = Date.now() + waitMs;
    let rec = await io.recording();
    if (rec.on === true) h.waiting?.(rec);
    while (rec.on === true && Date.now() < until) {
        await io.pause(opts.pollMs ?? 5_000);
        rec = await io.recording();
    }
    if (rec.on === true) {
        return { ...done, after: null, afterSkipped: `the recording on ${rec.display} was still running ${Math.round(waitMs / 60_000)} min after the logout, so no gate window was opened on it` };
    }
    const after = await gateTabRead(io, o.gateBot!, o.gateProbeTrials, 'after');
    h.gate(after);
    return { ...done, after };
}

/** The host's TabIO: lib/session.ts, lib/tab.ts over each env's CDP_URL, lib/display.ts on $DISPLAY. */
export function hostTabIO(frames: { dir: string; prefix: string }): TabIO {
    const display = process.env.DISPLAY || null;
    return {
        open: (bot, client) => openSession(bot, { client, launch: true }),
        probe: inPageRead,
        logout: s => logoutClean(s),
        stage: async bot => {
            const env = loadBotEnv(bot);
            const cdp = cdpUrl(env);
            if (!cdp) return null;
            if (!env.CLIENT_URL) throw new Error(`${bot} has no CLIENT_URL, so its bare client window can't be opened`);
            // The bare page carries the bot's name and no token: it waits on the title screen.
            const url = new URL(env.CLIENT_URL);
            url.searchParams.set('bot', env.BOT_USERNAME);
            return stageBotTab(cdp, env.BOT_USERNAME, url.toString());
        },
        closeTab: async s => {
            const cdp = cdpUrl(s.env);
            return cdp ? closeBotTabs(cdp, s.env.BOT_USERNAME) : null;
        },
        close: closeSession,
        recording: () => recordingState(display),
        pause: ms => Bun.sleep(ms),
        front: async s => {
            const cdp = cdpUrl(s.env);
            const skipped = (why: string): FrontReport => ({ ok: null, mark: s.name, display: null, tab: null, windows: null, frame: null, raised: false, warnings: [why] });
            if (s.client !== 'browser') return skipped('the lite client has no window');
            if (!cdp) return skipped('no CDP_URL: the tab was not brought to the front');
            const bot = s.env.BOT_USERNAME;
            mkdirSync(frames.dir, { recursive: true });
            return attemptFront(s.name, {
                display,
                tab: mark => frontTab(cdp, bot, mark),
                raise: () => raiseTabWindow(cdp, bot),
                windows: display ? () => frontWindows(xpropRunner(display)) : null,
                frame: display
                    ? async n => {
                          const framePath = join(frames.dir, `${frames.prefix}-frame-${n}.png`);
                          const pagePath = join(frames.dir, `${frames.prefix}-page-${n}.png`);
                          await grabFrame(display, framePath);
                          const page = await screenshotTab(cdp, bot);
                          if (!page) throw new Error(`${bot} has no tab to render`);
                          await Bun.write(pagePath, page);
                          return frameShows(framePath, pagePath);
                      }
                    : null,
                settle: () => Bun.sleep(500),
            });
        },
    };
}

// ------------------------------------------------------------------ the attempt

export interface SkillModule {
    skill: string;
    /** `to` and `toLevel` both carry --to: fishing and mining read `to`, firemaking (and the scored S03) `toLevel`. */
    steps(opts?: { to?: number; toLevel?: number; technique?: Technique; [k: string]: unknown }): Step<any>[];
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
    // This process's own bun: on the host it is ~/.bun/bin/bun, not on a non-login shell's PATH.
    const args = [process.execPath, 'docs/speedrun/scripts/tickmanip-latency.ts', gateBot, '--path=direct', `--json=${json}`, ...(opts.lab ? [] : ['--no-tele'])];
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

/**
 * Page reads, 5 s apart, before the check takes the page as it stands. Rows show about 3 s after a clean
 * logout (hiscore-timestamps.md), but only once the player has left the world: a logout that wasn't
 * confirmed can keep it there longer, and the read costs wall time only.
 */
const HISCORE_READS = 24;

/** The player page once `settled` accepts it (hiscoreSettled), else the last page read. */
async function readHiscore(account: string, origin: string, runId: string, settled: (rows: PlayerRow[] | null) => boolean): Promise<PlayerRow[] | null> {
    // A lab engine serves hiscores only when its web server is up; don't spend the fetcher's backoff on nothing.
    try {
        await fetch(origin, { signal: AbortSignal.timeout(5_000) });
    } catch {
        console.error(`[hiscore] ${origin} does not answer; skipped`);
        return null;
    }
    let last: PlayerRow[] | null = null;
    for (let attempt = 1; attempt <= HISCORE_READS; attempt++) {
        await Bun.sleep(5_000);
        const fetcher = new PoliteFetcher(join(ROOT, 'speedrun', 'runs', 'hiscore-cache', `rehearse-${runId}-${attempt}`), new Date(), origin);
        try {
            const html = await fetcher.get(playerPath(account));
            const rows = await withServerRate(origin, tickMs => parsePlayer(html, tickMs));
            if (rows) last = rows;
            if (settled(rows)) return rows;
        } catch (e) {
            console.error(`[hiscore] ${e instanceof Error ? e.message : e}`);
        }
    }
    if (last) console.error(`[hiscore] the page did not show this attempt's save in ${HISCORE_READS} reads; checking the last read as it stands`);
    return last;
}

async function main(argv: string[]): Promise<number> {
    const env = loadBotEnv(parseArgs(argv).bot);
    const local = isLocalWorld(env.SERVER);
    const a = local ? parseArgs(argv) : parseArgs(argv, { defaultGateBot: DEFAULT_GATE_BOT });
    if (a.lab && !local) throw new UsageError(`--lab accepts staff fixtures, and ${env.SERVER} is not a local lab`);

    // 0. Pre-flight: no login of any kind while the host is reserved for the gate or the run.
    const owner = claimOwner(a.claimOwner);
    const bin = owner ? claimBin() : null;
    const reservation = new ReservationWatch(reservationPath(a.hostReservation), owner ? { owner, touch: bin ? claimToucher(bin) : null } : {});
    if (owner) console.log(`[rehearse] under ${owner}'s claim (${reservation.path}); ${bin ? `renewed with ${bin} touch at step boundaries` : 'rs-claim not found, so it is not renewed: touch it by hand in a long hold'}`);
    const reserved = (): string | null => reservationRefusal(reservation);
    const refuseIfReserved = (): boolean => {
        const why = reserved();
        if (!why) return false;
        console.error(`[rehearse] REFUSED: ${why}`);
        console.error('[rehearse] nothing was logged in for the attempt');
        return true;
    };
    if (refuseIfReserved()) return EXIT_HOST_RESERVED;

    const mod = a.claim ? null : await loadSkillModule(a.skill!);
    const skillName = mod?.skill ?? CLAIM_SKILL;
    const start = await import('./skills/start');
    const runId = newRunId();
    // A resumed attempt appends to the same log; its earlier sessions count toward the summary and the hiscore check.
    const earlier = a.log && existsSync(a.log) ? parseLog(readFileSync(a.log, 'utf-8')) : [];
    const log = TickLog.open(`rehearse-${skillName}-${runId}`, a.log);
    const account = env.BOT_USERNAME;
    const origin = demoOrigin(env.SERVER);
    console.log(`[rehearse] ${account}: ${a.claim ? 'claim (S00, then logout)' : `${skillName} to ${a.to}`} on ${env.SERVER ?? 'localhost'} (${a.client}); log ${log.path}`);

    // 1. The gate, off the clock.
    const players = (await samplePlayerCount(origin)).players;
    log.append(annotation(log, account, 'gate', GATE_PLAYERS_STEP, { meta: { players, origin, ...(owner ? { claimOwner: owner } : {}) } }));
    if (a.claim) log.append(annotation(log, account, 'gate', '(gate) claim', { meta: { claim: true, note: 'S00 then logout only: no gate read, no probes, no skill steps' } }));
    let direct: DirectRead | null = null;
    if (a.gateJson) direct = parseDirectJson(JSON.parse(readFileSync(a.gateJson, 'utf-8')), 'gate-json');
    else if (a.gateBot) direct = await directReadViaCli(a.gateBot, { lab: a.lab, runId });
    if (direct) log.append(annotation(log, account, 'gate', '(gate) direct', { ok: !direct.error && direct.verdict?.on === true, ...(direct.error ? { error: direct.error } : {}), meta: { ...direct, ...(direct.verdict ? { text: verdictText(direct.verdict) } : {}) } }));
    // Which rule the direct read was held to, so every findings doc can say which applied.
    const kind = a.claim ? null : kindGate(a.kind, direct);
    if (kind) log.append(annotation(log, account, 'gate', '(gate) kind', { ok: kind.recordHeld !== false, ...(kind.recordShort ? { error: kind.recordShort } : {}), meta: { ...kind } }));
    const inPage: InPageRead[] = [];
    const gate: string[] = kind ? [kindText(kind)] : [];
    // The gate tab is a login too.
    if (a.gateProbeTrials > 0 && refuseIfReserved()) return EXIT_HOST_RESERVED;

    // The gate tab's before-probe, the attempt on the clock from its login, then the after-probe
    // (bracketAttempt: one of these accounts in the world, and on the recorded display, at a time).
    // The live frames are kept beside the log, as the pass line's evidence.
    const logPath = log.path ?? join(process.env.TMPDIR ?? '/tmp', 'speedrun', `rehearse-${runId}.jsonl`);
    const frames = { dir: dirname(logPath), prefix: `${basename(logPath, '.jsonl')}-${runId}` };
    const run = await bracketAttempt(hostTabIO(frames), { ...(a.gateBot ? { gateBot: a.gateBot } : {}), gateProbeTrials: a.gateProbeTrials, bot: a.bot, client: a.client }, {
        gate: r => {
            if (r.read) inPage.push(r.read);
            const problems = gateTabProblems(r);
            log.append(annotation(log, r.account, 'gate', `(gate) in-page ${r.when}`, {
                ok: problems.length === 0,
                ...(problems.length ? { error: problems.join('; ') } : {}),
                meta: { ...(r.read ? { ...r.read, text: verdictText(r.read.verdict) } : { label: r.label, account: r.account }), logout: r.logout, staged: r.staged ?? null, tab: r.tab },
            }));
            for (const p of problems) console.warn(`[gate] WARNING: ${p}`);
        },
        refusal: (before, recording) => {
            gate.push(
                `${players ?? '?'} players online`,
                ...(direct ? [gateLine({ label: `direct (${direct.source}, ${direct.takenAt ?? 'undated'})`, verdict: direct.verdict, ...(direct.error ? { error: direct.error } : {}) })] : []),
                ...(before?.read ? [gateLine(before.read)] : [])
            );
            const recProblems = a.client === 'browser' ? recordingProblems(recording) : [];
            const recLine = recording.on === true ? `recording on ${recording.display}: running (${recording.file ?? `pid ${recording.pid}`})` : `recording on ${recording.display ?? '?'}: ${recording.on === false ? 'NONE' : `unknown (${recording.why})`}`;
            if (a.client === 'browser') {
                gate.push(recLine);
                log.append(annotation(log, account, 'gate', '(gate) recording', { ok: recording.on === true, ...(recProblems.length ? { error: recProblems.join('; ') } : {}), meta: { ...recording } }));
            }
            for (const g of gate) console.log(`[gate] ${g}`);
            // The gate took minutes; a reservation may have appeared meanwhile. --force-gate does not override it.
            const res = reserved();
            if (res) return { code: EXIT_HOST_RESERVED, reasons: [res] };
            const reasons = [...gateRefusal({ direct, inPage, players, local, now: Date.now(), claim: a.claim, kind: a.kind }), ...(before ? gateTabProblems(before) : []), ...recProblems];
            if (!reasons.length) return null;
            // parseArgs refuses --force-gate with --kind=record, so a record attempt never gets past here.
            if (!a.forceGate) return { code: 3, reasons };
            for (const r of reasons) console.warn(`[rehearse] --force-gate: starting anyway: ${r}`);
            return null;
        },
        front: (f, s) => {
            log.append(annotation(log, account, 'gate', '(gate) live frame', { sessionId: s.sessionId, ok: f.ok === true, ...(f.ok ? {} : { error: f.warnings.join('; ') }), meta: { ...f } }));
            if (f.ok) console.log(`[gate] ${frontLine(f)}`);
            else console.warn(`[gate] WARNING: ${frontLine(f)}`);
        },
        waiting: r => console.log(`[gate] the after-probe waits for the recording on ${r.display} to stop (RUN-HOST.md step 8), at most ${RECORDING_WAIT_MS / 60_000} min`),
        attempt: async session => {
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
            // /playercount through the attempt (rs/158): an HTTP GET beside the game socket, no game packets.
            const readPlayers = async (label: 'during' | 'end') => {
                const smp = await samplePlayerCount(origin);
                // The client tick ties a read to the band it fell in; after the logout the state is stale.
                const st = session.expectInWorld ? session.sdk.getState() : null;
                log.append(annotation(log, account, 'players', `(players) ${label}`, {
                    sessionId: session.sessionId, ...(st?.inGame ? { startTick: st.tick } : {}),
                    meta: { players: smp.players, at: new Date(smp.at).toISOString(), ms: smp.ms, ...(smp.error ? { error: smp.error } : {}) },
                }));
                console.log(`[players] ${smp.players ?? `no answer (${smp.error})`}`);
            };
            const playersTimer = setInterval(() => void readPlayers('during'), PLAYERS_EVERY_MS);
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
            const leaveNow = (exitCode: number) => {
                if (leaving) return;
                console.error('[rehearse] logging out now');
                leaving = leave().finally(() => process.exit(exitCode));
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
            if (mod) chain.push(...mod.steps({ to: a.to, toLevel: a.to, ...(a.technique ? { technique: a.technique } : {}), ...a.skillOpts }));

            const result = await runAttempt(session, chain, {
                log,
                account,
                link: sessionLink(session),
                reservation,
                stopAsked: () => stopAsked,
                gateStop: () => gateStop,
                logout: () => leave(),
                ...(a.from !== undefined ? { from: a.from } : {}),
                onEvent: e => console.log(`[resume] ${JSON.stringify(e)}`),
            });
            if (result.paused) console.error(`[rehearse] ${result.outcome}`);

            // 3. Out of the world at once, then everything that costs no ticks.
            if (session.expectInWorld && !leaving) await leave();
            // After a deliberate logout (expectInWorld false) the watchdog relaunches nothing; stop it outright.
            wd.stop();
            clearInterval(playersTimer);
            monitor?.stop();
            process.off('SIGINT', onSigint);
            for (const st of programs.flush()) log.append(programRow(log, account, session.sessionId, st));
            unsubscribe();
            const out = lastLogout as LogoutResult | null;
            // A step that logged out itself: its click was on the last in-world tick (logout latency 0).
            closeSessionRow(session.sessionId, 'logout', out?.ok ? out.lastInWorldTick : session.lastInWorldTick, out ?? undefined);
            await readPlayers('end');
            return {
                value: result,
                loggedOut: out ? out.ok : !session.expectInWorld,
                // The host is reserved: the gate account stays out too, without its after-probe.
                ...(result.paused ? { skipAfter: 'paused for the gate/run' } : {}),
            };
        },
    });
    if (run.refused) {
        for (const r of run.refused.reasons) console.error(`[rehearse] REFUSED: ${r}`);
        console.error(`[rehearse] nothing was logged in for the attempt; ${run.refused.code === EXIT_HOST_RESERVED ? 'run again once the reservation is gone' : a.kind === 'record' ? 're-read the gate and run again (a record attempt takes no --force-gate)' : 're-read the gate and run again (or --force-gate)'}`);
        return run.refused.code;
    }
    const session = run.session!;
    const { outcome, code } = run.value!;
    if (run.front) gate.push(frontLine(run.front));
    if (run.after) gate.push(...(run.after.read ? [gateLine(run.after.read)] : []), ...gateTabProblems(run.after));
    if (run.afterSkipped) gate.push(`gate tab after: skipped: ${run.afterSkipped}`);

    const summary = summarize([...earlier, ...log.rows]);
    let checks: HiscoreCheck[] | null = null;
    const hiscoreOrigin = local ? (process.env.HISCORES_WEB_PORT ? `http://localhost:${process.env.HISCORES_WEB_PORT}` : null) : origin;
    if (hiscoreOrigin && !session.expectInWorld) {
        checks = compareHiscore(summary, await readHiscore(account, hiscoreOrigin, runId, rows => hiscoreSettled(summary, rows, skillName)), skillName);
        for (const c of checks) log.append(annotation(log, account, 'hiscore', `(hiscore) ${c.row}`, { ...(c.ok === false ? { ok: false } : {}), meta: { ...c } }));
    }
    console.log('\n' + formatSummary(summary, { account, skill: skillName, ...(a.claim ? {} : { to: a.to }), outcome, gate, hiscore: checks, ...(hiscoreOrigin ? { hiscoreUrl: `${hiscoreOrigin}${playerPath(account)}` } : {}) }));
    console.log(`log: ${log.path}`);
    if (code === 4) console.log('resume: run the same command again (the walk starts from game state); --from=<step> overrides it');
    if (code === EXIT_HOST_RESERVED) {
        const paused = run.value!.paused;
        if (owner && paused?.displaced === owner) console.log(`host preempted our claim: once teardown is confirmed, release it now (rs-claim release ${owner}); take nothing again until rs-claim status shows the machine free`);
        console.log(`resume: once ${reservation.path} is gone or expired, run the same command again (nothing restarts on its own)`);
    }
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
