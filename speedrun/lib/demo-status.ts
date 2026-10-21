// Demo-restart detection: one cheap signal the run script and the operator's
// screen both show ("demo up, 1,702 players, last restart 06:14 PDT, 1h32m ago").
//
// The demo's game process exits (crash or out-of-memory) and Fly restarts it in
// place every 1.5-3.5 h (cairn://p/rs/102). The outage seen from outside:
// /playercount stops answering for ~30 s, then answers 0, logins are refused
// with code 8 "Login server offline" for ~1.5-2.5 min, then accepted, and the
// count refills over ~10 min. A restart is therefore recognised by
// /playercount going unreachable or collapsing (to under a tenth of the
// recent running count), whichever is seen first; the in-world client sees the
// same moment as its ticks stopping.
//
// A second, earlier signal is a sustained severe tick-overrun burst (catch-ups:
// a tick interval under 150 ms right after one over 350 ms; rs/83, rs/102):
// 21-26 per minute ran for 4 minutes up to the 06:14 restart (n=1). It is
// exposed as `restartLikely` with its thresholds as parameters; what to do
// about it (pause the reactive loop) is the caller's policy.
//
// CLI:
//   bun speedrun/lib/demo-status.ts watch [--origin=https://rs-sdk-demo.fly.dev] [--every=20] [--file=speedrun/runs/demo-status.json] [--last-restart=<iso>]
//   bun speedrun/lib/demo-status.ts show [--file=...]

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

export interface DemoSample {
    /** Wall ms the sample was taken. */
    at: number;
    /** Players online, or null when /playercount did not answer. */
    players: number | null;
    /** Round trip of the request in ms. */
    ms: number;
    error?: string;
}

/** The HTTP origin of a world, from a bot.env SERVER value (host, host:port, or ws(s) URL). */
export function demoOrigin(server: string | undefined): string {
    const s = server ?? 'localhost';
    if (/^https?:\/\//.test(s)) return s.replace(/\/+$/, '');
    if (/^wss?:\/\//.test(s)) return s.replace(/^ws/, 'http').replace(/\/gateway$/, '').replace(/\/+$/, '');
    if (s.startsWith('localhost') || s.startsWith('127.')) return `http://${s.includes(':') ? s : `${s}:8888`}`;
    return `https://${s}`;
}

/** One GET of /playercount. Never throws: an unreachable world is `players: null`. */
export async function samplePlayerCount(origin: string, timeoutMs = 4_000): Promise<DemoSample> {
    const at = Date.now();
    try {
        const res = await fetch(`${origin}/playercount`, { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) return { at, players: null, ms: Date.now() - at, error: `HTTP ${res.status}` };
        const body = (await res.json()) as { count?: unknown };
        const players = typeof body.count === 'number' ? body.count : null;
        return { at, players, ms: Date.now() - at, ...(players === null ? { error: 'no count in reply' } : {}) };
    } catch (e) {
        return { at, players: null, ms: Date.now() - at, error: e instanceof Error ? e.message : String(e) };
    }
}

export type DemoPhase = 'unknown' | 'up' | 'down' | 'refusing' | 'recovering';

export interface RestartRecord {
    /** Wall ms of the first sample that saw the world gone (unreachable or collapsed). */
    downAt: number;
    /** Last sample before it that looked normal. */
    lastNormalAt: number | null;
    /** First answer with a count again. */
    answeringAt: number | null;
    /** First login accepted (ours), if seen. */
    loginAt: number | null;
    /** Logins refused during this outage (ours). */
    refusals: number;
    /** Players online just before. */
    playersBefore: number | null;
}

export interface TrackerOptions {
    /** A count under this share of the recent running count is a restart (default 0.1). */
    collapseShare?: number;
    /** Only a running count of at least this many can collapse (default 50; the lab has ~1). */
    collapseFloor?: number;
    /** The restart is over (phase up) once the count is back to this share of before (default 0.5)
     *  or `recoveredAfterMs` passed since logins were accepted. */
    recoveredShare?: number;
    recoveredAfterMs?: number;
    /** Severe-burst warning: at least `burstPerMinute` catch-ups in each of the last `burstMinutes` minutes. */
    burstPerMinute?: number;
    burstMinutes?: number;
}

export interface DemoStatus {
    v: 1;
    origin: string;
    phase: DemoPhase;
    players: number | null;
    sampledAt: number | null;
    lastRestart: RestartRecord | null;
    /** Catch-ups in each completed minute, newest last (at most 10). */
    catchUpsPerMinute: number[];
    restartLikely: boolean;
    updatedAt: number;
}

/**
 * Pure state machine over samples, login outcomes and catch-up counts. Feed it;
 * read `status()`. Holds no timers, so the run script, the CLI and the tests
 * drive it the same way.
 */
export class RestartTracker {
    private readonly o: Required<TrackerOptions>;
    private phase: DemoPhase = 'unknown';
    private players: number | null = null;
    private sampledAt: number | null = null;
    private running: number | null = null;
    private lastNormalAt: number | null = null;
    private current: RestartRecord | null = null;
    private last: RestartRecord | null;
    private minutes: number[] = [];

    constructor(readonly origin: string, opts: TrackerOptions = {}, seed: RestartRecord | null = null) {
        this.o = {
            collapseShare: opts.collapseShare ?? 0.1,
            collapseFloor: opts.collapseFloor ?? 50,
            recoveredShare: opts.recoveredShare ?? 0.5,
            recoveredAfterMs: opts.recoveredAfterMs ?? 10 * 60_000,
            burstPerMinute: opts.burstPerMinute ?? 10,
            burstMinutes: opts.burstMinutes ?? 2,
        };
        this.last = seed;
    }

    observe(s: DemoSample): void {
        this.sampledAt = s.at;
        this.players = s.players;
        const cur = this.current;
        if (!cur) {
            const collapsed = s.players !== null && this.running !== null && this.running >= this.o.collapseFloor && s.players < this.running * this.o.collapseShare;
            if (s.players === null || collapsed) {
                // Unreachable before any good sample: down, but no restart time to report.
                if (this.phase === 'unknown' && s.players === null) this.phase = 'down';
                else this.beginOutage(s.at, s.players);
                return;
            }
            this.phase = 'up';
            this.lastNormalAt = s.at;
            // Follows rises at once and decays slowly, so one low sample cannot hide a collapse.
            this.running = this.running === null ? s.players : Math.max(s.players, Math.round(this.running * 0.9 + s.players * 0.1));
            return;
        }
        if (s.players === null) {
            this.phase = cur.loginAt ? 'recovering' : 'down';
            return;
        }
        cur.answeringAt ??= s.at;
        const before = cur.playersBefore;
        const refilled = before !== null && before >= this.o.collapseFloor
            ? s.players >= before * this.o.recoveredShare
            : cur.loginAt !== null || (before === null && s.players >= this.o.collapseFloor * 10);
        const longAgo = cur.loginAt !== null && s.at - cur.loginAt >= this.o.recoveredAfterMs;
        if (refilled || longAgo) this.endOutage(s);
        else this.phase = cur.loginAt ? 'recovering' : 'refusing';
    }

    /** Our own login was refused (code 8 during an outage, or no answer). */
    noteLoginRefused(at: number): void {
        if (!this.current) this.beginOutage(at, this.players);
        this.current!.refusals++;
        if (!this.current!.loginAt) this.phase = this.players === null ? 'down' : 'refusing';
    }

    /** Our login was accepted: the server is taking logins again. */
    noteLoginAccepted(at: number): void {
        if (!this.current) return;
        this.current.loginAt ??= at;
        const before = this.current.playersBefore;
        if (before === null || before < this.o.collapseFloor) this.endOutage({ at, players: this.players, ms: 0 });
        else this.phase = 'recovering';
    }

    /** Catch-ups per completed minute, oldest first (CatchUpMeter.perMinute, or a program's frames). */
    noteCatchUps(perMinute: number[]): void {
        this.minutes = perMinute.slice(-10);
    }

    get restartLikely(): boolean {
        const n = this.o.burstMinutes;
        if (this.minutes.length < n) return false;
        return this.minutes.slice(-n).every(c => c >= this.o.burstPerMinute);
    }

    get inOutage(): boolean {
        return this.current !== null && this.current.loginAt === null;
    }

    status(now: number = Date.now()): DemoStatus {
        return {
            v: 1, origin: this.origin, phase: this.phase, players: this.players, sampledAt: this.sampledAt,
            lastRestart: this.current ?? this.last, catchUpsPerMinute: [...this.minutes], restartLikely: this.restartLikely, updatedAt: now,
        };
    }

    private beginOutage(at: number, players: number | null): void {
        this.current = { downAt: at, lastNormalAt: this.lastNormalAt, answeringAt: null, loginAt: null, refusals: 0, playersBefore: this.running };
        this.phase = players === null ? 'down' : 'refusing';
    }

    private endOutage(s: DemoSample): void {
        this.last = this.current;
        this.current = null;
        this.phase = 'up';
        this.lastNormalAt = s.at;
        this.running = s.players;
    }
}

/**
 * Catch-up counter over raw tick arrival times (main, 05:10): a catch-up is an
 * interval under 150 ms immediately after one over 350 ms. Counted per wall
 * minute; feed it every observed tick arrival, not grouped frames.
 */
export class CatchUpMeter {
    private prevAt: number | null = null;
    private prevInterval: number | null = null;
    private minuteStart: number | null = null;
    private count = 0;
    private readonly done: number[] = [];

    constructor(readonly shortMs = 150, readonly longMs = 350) {}

    arrival(at: number): void {
        if (this.minuteStart === null) this.minuteStart = at;
        while (at - this.minuteStart >= 60_000) {
            this.done.push(this.count);
            if (this.done.length > 10) this.done.shift();
            this.count = 0;
            this.minuteStart += 60_000;
        }
        if (this.prevAt !== null) {
            const interval = at - this.prevAt;
            if (this.prevInterval !== null && this.prevInterval > this.longMs && interval < this.shortMs) this.count++;
            this.prevInterval = interval;
        }
        this.prevAt = at;
    }

    /** Completed minutes, oldest first. */
    perMinute(): number[] {
        return [...this.done];
    }

    /** Catch-ups in the minute in progress. */
    get current(): number {
        return this.count;
    }
}

const PDT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export function clock(ms: number): string {
    return PDT.format(new Date(ms));
}

export function duration(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
    if (m > 0) return `${m}m${String(s % 60).padStart(2, '0')}s`;
    return `${s}s`;
}

/** The one line both the run script and the operator's screen print. Times are Pacific. */
export function formatStatus(s: DemoStatus, now: number = Date.now()): string {
    const parts: string[] = [];
    const r = s.lastRestart;
    switch (s.phase) {
        case 'up':
        case 'unknown':
            parts.push(`demo ${s.phase === 'up' ? 'up' : '?'}${s.players !== null ? `, ${s.players.toLocaleString('en-US')} players` : ''}`);
            break;
        case 'down':
            parts.push(`DEMO DOWN since ${r ? clock(r.downAt) : '?'}${r ? ` (${duration(now - r.downAt)})` : ''}, no answer`);
            break;
        case 'refusing':
            parts.push(`DEMO RESTARTING since ${r ? clock(r.downAt) : '?'}${r ? ` (${duration(now - r.downAt)})` : ''}, ${s.players ?? 0} players, logins refused${r?.refusals ? ` x${r.refusals}` : ''}`);
            break;
        case 'recovering':
            parts.push(`demo back${r?.loginAt ? ` (logins accepted ${duration(r.loginAt - r.downAt)} after the drop)` : ''}, ${s.players ?? '?'} players refilling`);
            break;
    }
    if (r && (s.phase === 'up' || s.phase === 'recovering' || s.phase === 'unknown')) parts.push(`last restart ${clock(r.downAt)}, ${duration(now - r.downAt)} ago`);
    if (s.catchUpsPerMinute.length) parts.push(`catch-ups ${s.catchUpsPerMinute[s.catchUpsPerMinute.length - 1]}/min`);
    if (s.restartLikely) parts.push('SEVERE OVERRUN: restart likely');
    if (s.sampledAt !== null && now - s.sampledAt > 90_000) parts.push(`(sample ${duration(now - s.sampledAt)} old)`);
    return parts.join(' | ');
}

export const DEFAULT_STATUS_FILE = join(import.meta.dir, '..', 'runs', 'demo-status.json');

/** Write the status atomically (tmp + rename) so a reader never sees half a file. */
export function writeStatus(file: string, s: DemoStatus): void {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(s) + '\n');
    renameSync(tmp, file);
}

export function readStatus(file: string): DemoStatus | null {
    if (!existsSync(file)) return null;
    try {
        return JSON.parse(readFileSync(file, 'utf-8')) as DemoStatus;
    } catch {
        return null;
    }
}

export interface MonitorOptions extends TrackerOptions {
    everyMs?: number;
    file?: string | null;
    /** Called after every sample with the formatted line. */
    onLine?: (line: string, s: DemoStatus) => void;
    sample?: (origin: string) => Promise<DemoSample>;
    /** Seed the last restart when the status file has none (e.g. from rs/102's log). */
    lastRestartAt?: number;
}

/**
 * Polls /playercount every `everyMs` (default 20 s, the rs/102 cadence), keeps
 * a RestartTracker, and writes the status file. The last restart survives a
 * restart of the monitor through the file.
 */
export class DemoMonitor {
    readonly tracker: RestartTracker;
    private timer: ReturnType<typeof setInterval> | null = null;
    private readonly file: string | null;

    constructor(readonly origin: string, private readonly opts: MonitorOptions = {}) {
        this.file = opts.file === undefined ? DEFAULT_STATUS_FILE : opts.file;
        const prior = this.file ? readStatus(this.file) : null;
        const seeded = opts.lastRestartAt === undefined ? null : { downAt: opts.lastRestartAt, lastNormalAt: null, answeringAt: null, loginAt: null, refusals: 0, playersBefore: null };
        this.tracker = new RestartTracker(origin, opts, (prior?.origin === origin ? prior.lastRestart : null) ?? seeded);
    }

    async sampleNow(): Promise<DemoStatus> {
        const s = await (this.opts.sample ?? samplePlayerCount)(this.origin);
        this.tracker.observe(s);
        return this.publish();
    }

    /** Re-publish after a login outcome or catch-up update without sampling. */
    publish(): DemoStatus {
        const st = this.tracker.status();
        if (this.file) writeStatus(this.file, st);
        this.opts.onLine?.(formatStatus(st), st);
        return st;
    }

    start(): this {
        if (this.timer) return this;
        void this.sampleNow();
        this.timer = setInterval(() => void this.sampleNow(), this.opts.everyMs ?? 20_000);
        return this;
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }
}

function arg(name: string): string | undefined {
    const hit = process.argv.find(a => a.startsWith(`--${name}=`));
    return hit?.slice(name.length + 3);
}

if (import.meta.main) {
    const cmd = process.argv[2] ?? 'watch';
    const file = arg('file') ?? DEFAULT_STATUS_FILE;
    if (cmd === 'show') {
        const s = readStatus(file);
        console.log(s ? formatStatus(s) : `no status at ${file}`);
    } else if (cmd === 'watch') {
        const origin = arg('origin') ?? 'https://rs-sdk-demo.fly.dev';
        const seed = arg('last-restart');
        const lastRestartAt = seed && Number.isFinite(Date.parse(seed)) ? Date.parse(seed) : undefined;
        new DemoMonitor(origin, { file, lastRestartAt, everyMs: Number(arg('every') ?? 20) * 1000, onLine: line => console.log(`${clock(Date.now())}  ${line}`) }).start();
    } else {
        console.error('usage: bun speedrun/lib/demo-status.ts watch|show [--origin=] [--every=20] [--file=] [--last-restart=<iso>]');
        process.exit(2);
    }
}
