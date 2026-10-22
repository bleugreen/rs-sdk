// Run a quest module on a real account from its real state: the demo world by default, the local
// lab engine with --lab, in FIXED dialogue only, with no staff command and no chat. The module's
// segments run through runSteps as the scored run would run them; nothing is staged.
//
//   bun speedrun/lab/quests/demo-quest.ts <account> --module=speedrun/quests/<quest>.ts \
//       [--opts=<json>] [--from=X] [--until=Y] [--fleet-account] [--trace=N] [--lab]
//
// Tenet 12: the account's bot.env carries GATEWAY_URL=ws://127.0.0.1:<port>; this script starts
// that loopback gateway (lab/loopback-gateway.ts) and launches the lite client against it.
//
// The start. --from names a segment letter or step name and wins outright (the operator's
// override, as runResumable's --from). Without it the canonical resume walk (runner/resume.ts
// resolveResume) picks it from the account's state, journal probes included: after the last done
// milestone, the latest step that is in progress or can start. --until ends the window.
//
// The account rules (checkDemoTarget): --lab only on the local engine and the demo path only off
// it; a cairn_* account only with --fleet-account, i.e. a fleet account its coordinator has taken
// out of the fleet for this run. Every chat line is refused at the SDK (refuseChat), which covers
// staff commands (`::`) too.
//
// For callers that do more around the module in the same login (prep, a leg in, a probe after),
// runDemoQuest runs the module on an open session and does not log out. Its hooks, both keyed by
// a segment letter or a full step name:
//   substitute  replaces a segment's run with the caller's (a fight the account cannot do the
//               module's way); the row is renamed `<name>[driver]` so it is never read as a
//               module sample. It keeps the segment's done, probes and logoutSafe, and its
//               postconditions unless it gives its own; its preconditions default to none.
//   legs        an untimed-for-the-module travel step run just before that segment, logged as
//               `leg:<name>`; skipped with the segment when the start lies past it.
//
// Prints a per-step table (module / driver / leg rows, boundaries, total) and a RESULT line, and
// always ends with a confirmed logout.

import { resolve } from 'node:path';
import type { BotWorldState } from '../../../sdk/types';
import { journalProbe, type QuestKey } from '../../lib/quests';
import { closeSession, loadBotEnv, openSession, type BotEnv } from '../../lib/session';
import { TickLog, type TickRow } from '../../lib/ticks';
import type { QuestOptions } from '../../quests/segments';
import { Observation, resolveResume, type Probe } from '../../runner/resume';
import { BOUNDARY_STEP, runSteps, type Check, type RunnerSession, type Step, type StepContext } from '../../runner/step';
import { arg, botArg, result } from '../common';
import { startLoopbackGateway } from '../loopback-gateway';
import { confirmedLogout } from './aereck-burst';
import { letterOf, selectSegments, trace } from './run';

/** What a quest module exports (speedrun/quests/*.ts). */
export interface QuestModule<O extends QuestOptions = QuestOptions> {
    stepId: string;
    steps(opts?: O): Step<any>[];
}

export interface Substitute {
    run(ctx: StepContext<any>): Promise<void>;
    /** Default: none (the bypass is this step's only). */
    preconditions?: Check<any>;
    /** Default: the module step's own. */
    postconditions?: Check<any>;
}

export type Leg = (ctx: StepContext<any>) => Promise<void>;

export interface DemoQuestOptions<O extends QuestOptions = QuestOptions> {
    module: QuestModule<O>;
    /** The module's options; `dialogue` is always 'fixed'. */
    opts?: Omit<O, 'dialogue'> & { dialogue?: string };
    /** First segment (letter or step name): skips the resume walk. */
    from?: string;
    /** Last segment (letter or step name), inclusive. */
    until?: string;
    log?: TickLog;
    substitute?: Readonly<Record<string, Substitute>>;
    legs?: Readonly<Record<string, Leg>>;
    /** Probes beyond the journal probes derived from the steps (`journal:<quest>`). */
    probes?: Readonly<Record<string, Probe>>;
}

export interface DemoQuestResult {
    rows: TickRow[];
    /** Where the run started, and why; null when the window was already done. */
    start: { step: string; mode: 'run' | 'resume'; reason: string } | null;
    finished: boolean;
    error?: string;
}

export const DRIVER_SUFFIX = '[driver]';
export const LEG_PREFIX = 'leg:';

/** The module options with dialogue forced to fixed; asking for burst is an error, not a silent change. */
export function fixedOptions<O extends QuestOptions>(opts: Omit<O, 'dialogue'> & { dialogue?: string } = {} as O): O {
    if (opts.dialogue !== undefined && opts.dialogue !== 'fixed') throw new Error(`demo-quest runs fixed dialogue only, not "${opts.dialogue}"`);
    return { ...opts, dialogue: 'fixed' } as O;
}

const isLocal = (server: string | undefined) => /^(localhost|127\.)/.test(server ?? '');

/** The account rules, checked before any login. */
export function checkDemoTarget(env: Pick<BotEnv, 'BOT_USERNAME' | 'SERVER'>, o: { lab: boolean; fleetAccount: boolean }): void {
    if (o.lab && !isLocal(env.SERVER)) throw new Error('--lab drives the local lab engine only');
    if (!o.lab && isLocal(env.SERVER)) throw new Error('without --lab this is a demo run: the account must point at the demo world');
    if (!o.lab && /^cairn_/i.test(env.BOT_USERNAME) && !o.fleetAccount) {
        throw new Error(`${env.BOT_USERNAME} is a fleet account: pass --fleet-account once its coordinator has taken it out of the fleet for this run`);
    }
}

/** Refuse every chat line on this SDK (staff commands are chat lines); returns the undo. */
export function refuseChat(sdk: { sendSay(message: string): Promise<unknown> }): () => void {
    const orig = sdk.sendSay;
    sdk.sendSay = (message: string) => Promise.reject(new Error(`demo-quest sends no chat and no staff command (refused: ${JSON.stringify(message.slice(0, 40))})`));
    return () => {
        sdk.sendSay = orig;
    };
}

function indexOfKey(steps: readonly Step<any>[], stepId: string, key: string, what: string): number {
    const i = steps.findIndex(s => s.name === key || letterOf(stepId, s.name) === key.toUpperCase());
    if (i < 0) throw new Error(`${what} "${key}": no such segment in ${steps.map(s => s.name).join(', ')}`);
    return i;
}

/** The steps with each substituted segment's run replaced and its row renamed `<name>[driver]`. */
export function applySubstitutes(steps: readonly Step<any>[], stepId: string, substitute: Readonly<Record<string, Substitute>> = {}): Step<any>[] {
    const out = [...steps];
    for (const [key, sub] of Object.entries(substitute)) {
        const i = indexOfKey(out, stepId, key, 'substitute');
        const s = out[i]!;
        if (s.name.endsWith(DRIVER_SUFFIX)) throw new Error(`substitute "${key}": ${s.name} is already substituted`);
        const { resume: _moduleResume, ...kept } = s;
        out[i] = {
            ...kept,
            name: `${s.name}${DRIVER_SUFFIX}`,
            preconditions: sub.preconditions ?? (() => true),
            postconditions: sub.postconditions ?? s.postconditions,
            run: ctx => sub.run(ctx),
        };
    }
    return out;
}

/** The steps from `start` on, each leg inserted just before its segment as `leg:<name>`. */
export function withLegs(steps: readonly Step<any>[], stepId: string, legs: Readonly<Record<string, Leg>> = {}, start = 0): Step<any>[] {
    const before = new Map<number, Leg>();
    for (const [key, leg] of Object.entries(legs)) before.set(indexOfKey(steps, stepId, key, 'leg'), leg);
    const out: Step<any>[] = [];
    for (let i = start; i < steps.length; i++) {
        const leg = before.get(i);
        if (leg) out.push({ name: `${LEG_PREFIX}${steps[i]!.name}`, preconditions: () => true, run: leg, postconditions: () => true, logoutSafe: true });
        out.push(steps[i]!);
    }
    return out;
}

/** The probes the steps declare: `journal:<quest>` reads the quest journal; any other name must be given. */
export function probesFor(steps: readonly Step<any>[], given: Readonly<Record<string, Probe>> = {}): Record<string, Probe> {
    const out: Record<string, Probe> = { ...given };
    for (const name of new Set(steps.flatMap(s => s.probes ?? []))) {
        if (name in out) continue;
        const m = /^journal:(.+)$/.exec(name);
        if (!m) throw new Error(`probe "${name}" is not a journal probe; pass it in probes`);
        out[name] = journalProbe(m[1] as QuestKey) as Probe;
    }
    return out;
}

export type RowSource = 'module' | 'driver' | 'leg' | 'boundary';

export function rowSource(step: string): RowSource {
    if (step === BOUNDARY_STEP) return 'boundary';
    if (step.startsWith(LEG_PREFIX)) return 'leg';
    if (step.endsWith(DRIVER_SUFFIX)) return 'driver';
    return 'module';
}

/**
 * Run `o.module` on an open session in fixed dialogue, from `o.from` or the resume walk's start,
 * to `o.until`. Never logs out and never throws for a step's failure: the error comes back with
 * the rows. Chat is refused for the call.
 */
export async function runDemoQuest<O extends QuestOptions>(session: RunnerSession, o: DemoQuestOptions<O>): Promise<DemoQuestResult> {
    const log = o.log ?? TickLog.memory();
    const { stepId } = o.module;
    const all = o.module.steps(fixedOptions<O>(o.opts));
    const window = applySubstitutes(selectSegments(all, stepId, o.from ?? all[0]!.name, o.until ?? all[all.length - 1]!.name), stepId, o.substitute);
    const allow = refuseChat(session.sdk as unknown as { sendSay(m: string): Promise<unknown> });
    try {
        let index = 0;
        let mode: 'run' | 'resume' = 'run';
        let reason = 'operator --from';
        let observed: Observation | undefined;
        if (o.from === undefined) {
            const state = session.sdk.getState() as BotWorldState | null;
            if (!state) throw new Error('no published state to walk from');
            observed = new Observation(state, probesFor(window, o.probes), session);
            const point = await resolveResume(window, observed, {});
            if (point.mode === 'finished') return { rows: log.rows, start: null, finished: true };
            ({ index, mode, reason } = point as { index: number; mode: 'run' | 'resume'; reason: string });
        }
        // A resumed segment is already under way: its leg is behind it.
        const steps = withLegs(window, stepId, o.legs, index);
        const first = mode === 'resume' ? steps.findIndex(s => s.name === window[index]!.name) : 0;
        const start = { step: window[index]!.name, mode, reason };
        try {
            await runSteps(session, steps, {
                log, c: {}, from: first, shouldStop: () => false, logout: async () => {}, tickMonitor: false,
                ...(mode === 'resume' ? { startMode: 'resume' as const, ...(observed ? { observed } : {}) } : {}),
            });
        } catch (e) {
            return { rows: log.rows, start, finished: false, error: e instanceof Error ? e.message : String(e) };
        }
        return { rows: log.rows, start, finished: true };
    } catch (e) {
        return { rows: log.rows, start: null, finished: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
        allow();
    }
}

/** The run's rows as a markdown table: each step with its source, the boundaries, the total. */
export function formatDemoTable(rows: readonly TickRow[], label = 'demo'): string {
    const steps = rows.filter(r => !r.kind && r.step !== BOUNDARY_STEP);
    const boundary = rows.filter(r => !r.kind && r.step === BOUNDARY_STEP).reduce((a, r) => a + r.ticks, 0);
    const sum = (src: RowSource) => steps.filter(r => rowSource(r.step) === src).reduce((a, r) => a + r.ticks, 0);
    return [
        `| Step | Source | Ticks (${label}) | ok |`,
        '|---|---|---|---|',
        ...steps.map(r => `| ${r.step} | ${rowSource(r.step)} | ${r.ticks} | ${r.ok ? 'yes' : `no: ${r.error ?? ''}`} |`),
        `| (boundaries) | boundary | ${boundary} | |`,
        `| **Module steps** | module | ${sum('module')} | |`,
        `| **Total** | all | ${steps.reduce((a, r) => a + r.ticks, 0) + boundary} | |`,
    ].join('\n');
}

async function main(): Promise<void> {
    const account = botArg();
    const lab = process.argv.includes('--lab');
    const fleetAccount = process.argv.includes('--fleet-account');
    const modulePath = arg('module', '');
    if (!modulePath) throw new Error('--module=<path to a quest module> is required');
    const opts = JSON.parse(arg('opts', '{}')) as Record<string, unknown>;
    const from = arg('from', '') || undefined;
    const until = arg('until', '') || undefined;
    const traceEvery = Number(arg('trace', '0'));
    checkDemoTarget(loadBotEnv(account), { lab, fleetAccount });
    const mod = (await import(resolve(modulePath))) as Partial<QuestModule>;
    if (typeof mod.steps !== 'function' || typeof mod.stepId !== 'string') throw new Error(`${modulePath} does not export steps() and stepId`);
    fixedOptions(opts);

    const gateway = lab ? null : await startLoopbackGateway(account, 'demo-quest');
    let exit = 1;
    const out: Record<string, unknown> = { account, lab, module: modulePath, stepId: mod.stepId, opts, ...(from ? { from } : {}), ...(until ? { until } : {}) };
    let rows: TickRow[] = [];
    try {
        const session = await openSession(account, { launch: true, readyTimeoutMs: 180_000 });
        const untrace = traceEvery > 0 ? trace(session.sdk, traceEvery) : () => undefined;
        try {
            const s0 = session.sdk.getState()!;
            out.startAt = [s0.player?.worldX, s0.player?.worldZ, s0.player?.level];
            const r = await runDemoQuest(session, { module: mod as QuestModule, opts, ...(from ? { from } : {}), ...(until ? { until } : {}), log: TickLog.open(`demo-quest-${account}`) });
            rows = r.rows;
            Object.assign(out, { start: r.start, finished: r.finished, ...(r.error ? { error: r.error } : {}) });
            if (r.finished && !r.error) exit = 0;
        } catch (e) {
            out.error = e instanceof Error ? e.message : String(e);
        } finally {
            untrace();
            const s1 = session.sdk.getState();
            out.endAt = [s1?.player?.worldX, s1?.player?.worldZ, s1?.player?.level];
            try {
                const lo = await confirmedLogout(session);
                out.logout = { ok: true, confirmedBy: lo.confirmedBy, latencyTicks: lo.latencyTicks };
            } catch (e) {
                out.logout = { ok: false, reason: e instanceof Error ? e.message : String(e) };
                exit = 2;
            }
            await closeSession(session);
        }
    } finally {
        gateway?.kill('SIGTERM');
    }
    out.ticks = Object.fromEntries(rows.filter(r => !r.kind && r.step !== BOUNDARY_STEP).map(r => [r.step, r.ok ? r.ticks : `fail@${r.ticks}`]));
    console.log(`\n${formatDemoTable(rows, lab ? 'lab' : 'demo')}\n`);
    result('demo_quest', out);
    process.exit(exit);
}

if (import.meta.main) await main();
