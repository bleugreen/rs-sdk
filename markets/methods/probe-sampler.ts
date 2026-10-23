// Shared runtime of the live probes (probe-knights.ts, probe-coal.ts; docs/markets/probes.md):
// argument parsing, the 50-tick JSONL sampler, the totals line, and the lifecycle that opens a
// session on an already running lite client, runs the probe, and always leaves the world through
// logoutClean, on a normal end, an error, or SIGINT/SIGTERM.
//
// Output is JSON lines, one object each, labelled by `kind`:
//   sample  every SAMPLE_EVERY_TICKS game ticks: UTC time, tick, phase, position, coins (inventory,
//           and the bank's count when the bank interface is open, else null), the probe's item
//           counts the same way, and the other players within NEAR_RADIUS tiles
//   event   something the probe did (a bank visit, a sale, a restock), with the tick
//   totals  once, last: the probe's own totals, ticks per phase, wall time, the measured ms per
//           tick, and the logout outcome
//
// The probe attaches to the account's lite client (cd server/webclient && bun src/lite/runner.ts
// <account>) through a loopback gateway, as speedrun/helpers/coins.ts does: the demo's public
// gateway relays state in bursts, and lib/session.ts refuses it for a remote world.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';
import type { LogoutResult } from '../../speedrun/lib/session';

export const SAMPLE_EVERY_TICKS = 50;
/** Other players within this many tiles (Chebyshev) are counted in each sample. */
export const NEAR_RADIUS = 5;

// ------------------------------------------------------------------ arguments

export interface Args {
    positional: string[];
    flags: Record<string, string>;
}

/** `--name value` and `--name=value`; a flag followed by another flag (or nothing) reads as 'true'. */
export function parseArgs(argv: readonly string[]): Args {
    const positional: string[] = [];
    const flags: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]!;
        if (!a.startsWith('--')) {
            positional.push(a);
            continue;
        }
        const eq = a.indexOf('=');
        if (eq > 0) {
            flags[a.slice(2, eq)] = a.slice(eq + 1);
            continue;
        }
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
            flags[a.slice(2)] = next;
            i++;
        } else flags[a.slice(2)] = 'true';
    }
    return { positional, flags };
}

/** A numeric flag: its default when absent; throws when it is not a number in [min, max] (or not whole when `integer`). */
export function numberFlag(a: Args, name: string, def: number, o: { min?: number; max?: number; integer?: boolean } = {}): number {
    const raw = a.flags[name];
    if (raw === undefined) return def;
    const n = Number(raw);
    if (!Number.isFinite(n) || raw.trim() === '') throw new Error(`--${name} must be a number, not '${raw}'`);
    if (o.integer && !Number.isInteger(n)) throw new Error(`--${name} must be a whole number, not ${raw}`);
    if (o.min !== undefined && n < o.min) throw new Error(`--${name} must be at least ${o.min}, not ${raw}`);
    if (o.max !== undefined && n > o.max) throw new Error(`--${name} must be at most ${o.max}, not ${raw}`);
    return n;
}

export interface CommonOptions {
    account: string;
    /** Wall-clock minutes of the measured activity (0 skips it). */
    minutes: number;
    /** JSONL file to append to; null writes to stdout. */
    out: string | null;
}

export function commonOptions(a: Args, known: readonly string[]): CommonOptions {
    const account = a.positional[0];
    if (!account) throw new Error('the account name is required (bots/<account>/bot.env)');
    if (a.positional.length > 1) throw new Error(`unexpected arguments: ${a.positional.slice(1).join(' ')}`);
    const unknown = Object.keys(a.flags).filter(k => !['minutes', 'out', ...known].includes(k));
    if (unknown.length) throw new Error(`unknown option${unknown.length > 1 ? 's' : ''}: ${unknown.map(k => `--${k}`).join(' ')}`);
    if (a.flags.minutes === undefined) throw new Error('--minutes N is required');
    const out = a.flags.out;
    if (out === 'true') throw new Error('--out needs a file name');
    return { account, minutes: numberFlag(a, 'minutes', 0, { min: 0, max: 24 * 60 }), out: out ?? null };
}

// ------------------------------------------------------------------ records

/** Counted in the inventory, and in the bank while the bank interface is open (else null). */
export interface Held {
    inventory: number;
    bank: number | null;
}

export interface SampleRecord {
    kind: 'sample';
    probe: string;
    t: string;
    tick: number;
    phase: string;
    x: number;
    z: number;
    level: number;
    hp: number;
    coins: Held;
    items: Record<string, Held>;
    /** Other players within NEAR_RADIUS tiles. */
    playersNear: number;
}

export interface TotalsRecord {
    kind: 'totals';
    probe: string;
    account: string;
    t: string;
    startedAt: string;
    wallMs: number;
    startTick: number;
    endTick: number;
    ticks: number;
    /**
     * Wall milliseconds per game tick, measured by the sampler between the first and the last tick
     * it observed (the same window as `ticks`), rounded to 0.1; null when it observed no tick pass.
     * The window starts after login and ends with the last tick of the logout, so it excludes the
     * time `wallMs` spends opening and closing the session.
     */
    observedMsPerTick: number | null;
    /** 'done', 'signal' (SIGINT/SIGTERM), or 'error'. */
    end: 'done' | 'signal' | 'error';
    error?: string;
    /** Game ticks spent in each phase, from the sampler's per-state accounting. */
    phaseTicks: Record<string, number>;
    logout: { ok: boolean; reason?: string; latencyTicks?: number } | null;
    [k: string]: unknown;
}

const COINS = /^coins$/i;

function count(items: ReadonlyArray<{ name: string; count: number }>, re: RegExp): number {
    return items.filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
}

export function held(s: BotWorldState, re: RegExp): Held {
    return { inventory: count(s.inventory, re), bank: s.bank?.isOpen ? count(s.bank.items, re) : null };
}

export function playersNear(s: BotWorldState, radius = NEAR_RADIUS): number {
    const p = s.player;
    if (!p) return 0;
    return s.nearbyPlayers.filter(o => o.name !== p.name && Math.max(Math.abs(o.x - p.worldX), Math.abs(o.z - p.worldZ)) <= radius).length;
}

export function sampleRecord(s: BotWorldState, probe: string, phase: string, items: Readonly<Record<string, RegExp>>, now: Date = new Date()): SampleRecord {
    const p = s.player;
    return {
        kind: 'sample',
        probe,
        t: now.toISOString(),
        tick: s.tick,
        phase,
        x: p?.worldX ?? 0,
        z: p?.worldZ ?? 0,
        level: p?.level ?? 0,
        hp: p?.hp ?? 0,
        coins: held(s, COINS),
        items: Object.fromEntries(Object.entries(items).map(([k, re]) => [k, held(s, re)])),
        playersNear: playersNear(s),
    };
}

export type Sink = (record: object) => void;

/** Appends one JSON line per record to `out`, or prints it on stdout. */
export function jsonlSink(out: string | null): Sink {
    if (out) mkdirSync(dirname(out), { recursive: true });
    return record => {
        const line = JSON.stringify(record) + '\n';
        if (out) appendFileSync(out, line);
        else process.stdout.write(line);
    };
}

// ------------------------------------------------------------------ sampler

type StateSource = Pick<BotSDK, 'getState' | 'onStateUpdate'>;

/**
 * Writes a sample on the first state it sees and then every SAMPLE_EVERY_TICKS ticks, and counts
 * every tick that passes against the current phase (`phase`), so a probe's totals can say where
 * its ticks went without timing each errand itself.
 */
export class Sampler {
    phase = 'start';
    readonly phaseTicks: Record<string, number> = {};
    startTick = -1;
    lastTick = -1;
    /** Wall-clock epoch ms at which startTick and lastTick were observed. */
    private startAt = -1;
    private lastAt = -1;
    private nextSampleTick = -1;
    private off: (() => void) | null = null;

    constructor(
        private readonly sdk: StateSource,
        private readonly sink: Sink,
        private readonly probe: string,
        private readonly items: Readonly<Record<string, RegExp>>,
        private readonly every = SAMPLE_EVERY_TICKS,
        private readonly now: () => Date = () => new Date(),
    ) {}

    start(): void {
        const s = this.sdk.getState();
        if (s?.inGame) this.see(s);
        this.off = this.sdk.onStateUpdate(st => this.see(st));
    }

    /** Called for each published state (start() subscribes it). */
    see(s: BotWorldState): void {
        if (!s.inGame || !s.player) return;
        const now = this.now();
        if (this.startTick < 0) {
            this.startTick = s.tick;
            this.startAt = now.getTime();
        }
        if (this.lastTick >= 0 && s.tick > this.lastTick) this.phaseTicks[this.phase] = (this.phaseTicks[this.phase] ?? 0) + (s.tick - this.lastTick);
        if (s.tick > this.lastTick) {
            this.lastTick = s.tick;
            this.lastAt = now.getTime();
        }
        if (this.nextSampleTick < 0 || s.tick >= this.nextSampleTick) {
            this.sink(sampleRecord(s, this.probe, this.phase, this.items, now));
            this.nextSampleTick = s.tick + this.every;
        }
    }

    /**
     * Wall ms per tick between the first and the last tick observed, to 0.1 ms; null until a tick
     * has passed. Both ends are arrival times of published states, so delivery delay cancels out.
     */
    observedMsPerTick(): number | null {
        const ticks = this.lastTick - this.startTick;
        if (this.startTick < 0 || ticks <= 0) return null;
        return Math.round(((this.lastAt - this.startAt) / ticks) * 10) / 10;
    }

    stop(): void {
        this.off?.();
        this.off = null;
    }
}

// ------------------------------------------------------------------ lifecycle

/** What a probe body needs from the session: lib/session.ts's Session satisfies it. */
export interface ProbeSession {
    name: string;
    sessionId: number;
    sdk: BotSDK;
    bot: BotActions;
    env: { SERVER?: string; [k: string]: string | undefined };
}

export interface ProbeContext<O> {
    session: ProbeSession;
    sdk: BotSDK;
    bot: BotActions;
    options: O;
    /** Aborted by SIGINT/SIGTERM: return at the next safe point; the lifecycle then logs out. */
    signal: AbortSignal;
    sampler: Sampler;
    /**
     * The probe's own totals, filled in as it goes: the totals line carries whatever is here when
     * the run ends, finished, failed or cancelled by a signal mid-action.
     */
    totals: Record<string, unknown>;
    /** An `event` line in the output, and the same on stderr. */
    event(message: string, data?: Record<string, unknown>): void;
}

export interface ProbeSpec<O extends CommonOptions> {
    name: string;
    usage: string;
    parse(a: Args): O;
    /** Item counts each sample carries, by label. */
    items: Readonly<Record<string, RegExp>>;
    /**
     * Runs the probe, keeping its totals in `ctx.totals`. It runs inside the SDK's execution
     * context (sdk/execution-context.ts), so a signal also rejects the SDK wait in flight; loops
     * should still check `signal` between actions.
     */
    run(ctx: ProbeContext<O>): Promise<void>;
}

export interface ProbeDeps {
    open(account: string): Promise<ProbeSession>;
    logout(session: ProbeSession): Promise<Pick<LogoutResult, 'ok' | 'reason' | 'latencyTicks'>>;
    close(session: ProbeSession): Promise<void>;
    /** Subscribe to a process signal; returns the unsubscribe. */
    onSignal(signal: 'SIGINT' | 'SIGTERM', handler: () => void): () => void;
    /** A second signal while logging out: leave at once. */
    forceExit(code: number): void;
    sink(out: string | null): Sink;
    stderr(line: string): void;
    /** Wall-clock epoch ms: the totals' times and the sampler's tick timing. */
    now(): number;
    /** Run `work` with `signal` as the SDK's execution signal. */
    withSignal<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T>;
}

export const defaultDeps: ProbeDeps = {
    async open(account) {
        const { openSession } = await import('../../speedrun/lib/session');
        return openSession(account);
    },
    async logout(session) {
        const { logoutClean } = await import('../../speedrun/lib/session');
        return logoutClean(session as never);
    },
    async close(session) {
        await session.sdk.disconnect().catch(() => undefined);
    },
    onSignal(signal, handler) {
        process.on(signal, handler);
        return () => process.off(signal, handler);
    },
    forceExit(code) {
        process.exit(code);
    },
    sink: jsonlSink,
    stderr: line => process.stderr.write(line + '\n'),
    now: () => Date.now(),
    async withSignal(signal, work) {
        const { executionContext } = await import('../../sdk/execution-context');
        return executionContext.run({ signal }, work);
    },
};

/**
 * Parse, open the session, sample, run the probe, log out with logoutClean, write the totals line.
 * The first SIGINT or SIGTERM aborts the probe's signal, so the probe stops at its next check and
 * the logout still runs; a second one exits at once (130). Resolves to the exit code: 0 after a
 * finished or signalled run that logged out, 1 after an error or a failed logout, 2 on bad arguments.
 */
export async function runProbe<O extends CommonOptions>(spec: ProbeSpec<O>, argv: readonly string[], deps: ProbeDeps = defaultDeps): Promise<number> {
    let options: O;
    try {
        options = spec.parse(parseArgs(argv));
    } catch (e) {
        deps.stderr(`${spec.name}: ${e instanceof Error ? e.message : String(e)}\n${spec.usage}`);
        return 2;
    }
    const sink = deps.sink(options.out);
    const controller = new AbortController();
    let signals = 0;
    const onSignal = (name: string) => () => {
        signals++;
        if (signals > 1) {
            deps.stderr(`${spec.name}: second ${name}, exiting without waiting for the logout`);
            deps.forceExit(130);
            return;
        }
        deps.stderr(`${spec.name}: ${name}: stopping, then logging out`);
        controller.abort(new Error(name));
    };
    const offs = [deps.onSignal('SIGINT', onSignal('SIGINT')), deps.onSignal('SIGTERM', onSignal('SIGTERM'))];
    const t0 = deps.now();
    const startedAt = new Date(t0);
    let session: ProbeSession | null = null;
    let sampler: Sampler | null = null;
    let end: TotalsRecord['end'] = 'done';
    let error: string | undefined;
    const own: Record<string, unknown> = {};
    let logout: TotalsRecord['logout'] = null;
    try {
        session = await deps.open(options.account);
        const { sdk, bot } = session;
        sampler = new Sampler(sdk, sink, spec.name, spec.items, SAMPLE_EVERY_TICKS, () => new Date(deps.now()));
        sampler.start();
        const s = sampler;
        const event = (message: string, data: Record<string, unknown> = {}) => {
            const rec = { kind: 'event', probe: spec.name, t: new Date(deps.now()).toISOString(), tick: sdk.getState()?.tick ?? -1, phase: s.phase, message, ...data };
            sink(rec);
            if (options.out) deps.stderr(JSON.stringify(rec));
        };
        event('start', { options });
        const ctx: ProbeContext<O> = { session, sdk, bot, options, signal: controller.signal, sampler: s, totals: own, event };
        await deps.withSignal(controller.signal, () => spec.run(ctx));
        if (controller.signal.aborted) end = 'signal';
    } catch (e) {
        if (controller.signal.aborted) end = 'signal';
        else {
            end = 'error';
            error = e instanceof Error ? e.message : String(e);
            deps.stderr(`${spec.name}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
        }
    }
    if (sampler) sampler.phase = 'logout';
    if (session) {
        try {
            const r = await deps.logout(session);
            logout = { ok: r.ok, ...(r.reason ? { reason: r.reason } : {}), latencyTicks: r.latencyTicks };
        } catch (e) {
            logout = { ok: false, reason: e instanceof Error ? e.message : String(e) };
        }
    }
    sampler?.stop();
    const t1 = deps.now();
    const totals: TotalsRecord = {
        kind: 'totals',
        probe: spec.name,
        account: options.account,
        t: new Date(t1).toISOString(),
        startedAt: startedAt.toISOString(),
        wallMs: t1 - t0,
        startTick: sampler?.startTick ?? -1,
        endTick: sampler?.lastTick ?? -1,
        ticks: sampler && sampler.startTick >= 0 ? sampler.lastTick - sampler.startTick : 0,
        observedMsPerTick: sampler?.observedMsPerTick() ?? null,
        end,
        ...(error ? { error } : {}),
        phaseTicks: { ...(sampler?.phaseTicks ?? {}) },
        logout,
        ...own,
    };
    sink(totals);
    if (session) await deps.close(session);
    for (const off of offs) off();
    return end === 'error' || !logout?.ok ? 1 : 0;
}

// ------------------------------------------------------------------ shared moves

export interface Tile {
    x: number;
    z: number;
}

export const cheb = (a: Tile, b: Tile): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
export const here = (s: BotWorldState | null): Tile => ({ x: s?.player?.worldX ?? 0, z: s?.player?.worldZ ?? 0 });
export const coinsIn = (s: BotWorldState | null): number => count(s?.inventory ?? [], COINS);

/**
 * Walk to within `tolerance` of `to` with the SDK's walkTo, its timeout scaled to the distance
 * (one tile a tick walking, so long legs are not cut short), retrying up to `attempts` times.
 * Throws when the player is still not there.
 */
export async function walk(bot: Pick<BotActions, 'walkTo'>, sdk: Pick<BotSDK, 'getState'>, to: Tile, o: { tolerance?: number; attempts?: number; signal?: AbortSignal; tickMs?: number } = {}): Promise<void> {
    const tolerance = o.tolerance ?? 2;
    for (let i = 0; i < (o.attempts ?? 4); i++) {
        if (o.signal?.aborted) return;
        const d = cheb(here(sdk.getState()), to);
        if (d <= tolerance) return;
        await bot.walkTo(to.x, to.z, tolerance, { timeout: Math.max(60_000, (d + 40) * (o.tickMs ?? 600) * 1.5) });
    }
    if (o.signal?.aborted) return;
    const at = here(sdk.getState());
    if (cheb(at, to) > tolerance) throw new Error(`could not walk to ${to.x},${to.z} (at ${at.x},${at.z})`);
}
