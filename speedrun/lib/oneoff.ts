// Scored-side one-offs: the isolation rule every tool under speedrun/tools/oneoff/ obeys, and the
// skeleton they share (host's read-a4.ts of attempts 3-4).
//
// A one-off logs SCORED in outside the run (an axe drop, a shark receive, a state read, a walk). It is
// launched only through speedrun/tools/oneoff.ts, which raises its own gateway on 7781, writes the alias
// env bots/host-oneoff/bot.env (SCORED's credentials with GATEWAY_URL=ws://127.0.0.1:7781), and hands
// the tool LITE_BOT_ENV and GATEWAY_URL. Both halves of the session have to land on 7781:
// - the SDK: openSession reads bots/<name>/bot.env unless it is handed `env`, and SCORED's own env names
//   the run's gateway (7780);
// - the lite runner openSession launches: it is given only the login name, so it reads
//   bots/<login>/bot.env (7780 again) unless LITE_BOT_ENV names another file.
// Either half on 7780 splits the session: the SDK sees a stale state or none, the logout cannot be
// confirmed, the runner is killed, and the body stays in the world for ~500 ticks with no connection
// (attempt 4, 02:47Z and 12:54Z on 2026-10-24). loadOneoffEnv checks both before anything logs in.
//
// SCORED's name never enters the repo: it is read at run time from ~/rs-run/.scored-account, and
// every ledger line is redacted (the name becomes SCORED, a courier's COURIER) before it is printed or
// written.

import { createHash } from 'crypto';
import { appendFileSync, existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { demoOrigin, playerNameKey } from './demo-status';
import {
    abandonClient,
    closeSession,
    describeAbandon,
    loadBotEnv,
    logoutClean,
    openSession,
    ROOT,
    type AbandonResult,
    type BotEnv,
    type LogoutResult,
    type Session,
} from './session';
import { sleep, tickMs } from './wait';

/** The alias bot directory under bots/: SCORED's credentials, pointed at the one-off gateway. */
export const ONEOFF_ALIAS = 'host-oneoff';
export const ONEOFF_PORT = 7781;
export const ONEOFF_GATEWAY_URL = `ws://127.0.0.1:${ONEOFF_PORT}`;
/** The run's gateway (run-gate.ts `up`): no one-off may touch it. */
export const RUN_GATEWAY_PORT = 7780;
/** Where the run host keeps the scored account's login name, one line. */
export const SCORED_ACCOUNT_FILE = join(homedir(), 'rs-run', '.scored-account');
/** The one-off ledger's file name in the run dir. Never relogs.json: a one-off is not a run relog. */
export const LEDGER_FILE = 'oneoff-drop.jsonl';

/** How a tool exits. The wrapper adds its own (9 refused, 10 isolation breach, 11 teardown). */
export const EXIT = { ok: 0, usage: 2, stop: 3, check: 4, error: 5, logout: 6, offline: 7, open: 8 } as const;

export function aliasEnvPath(root: string = ROOT): string {
    return join(root, 'bots', ONEOFF_ALIAS, 'bot.env');
}

export function readScoredAccount(file: string = SCORED_ACCOUNT_FILE): string {
    let name: string;
    try {
        name = readFileSync(file, 'utf8').trim();
    } catch {
        throw new Error(`no scored account file at ${file}`);
    }
    if (!name) throw new Error(`${file} is empty`);
    return name;
}

/** The port a ws:// or wss:// URL connects to, or null when it is not one. */
export function urlPort(url: string): number | null {
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return null;
    }
    if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return null;
    return u.port ? Number(u.port) : u.protocol === 'wss:' ? 443 : 80;
}

const VIA_WRAPPER = 'run the tool through speedrun/tools/oneoff.ts, the only launch path for a scored-side one-off';

/**
 * Why a one-off may not open with `env` (the alias env) in a process with environment `proc`, or null
 * when both the SDK and the lite runner it launches will be on the one-off gateway. Values that could
 * name the account (LITE_BOT_ENV's path) are never quoted.
 */
export function isolationRefusal(env: BotEnv, proc: Record<string, string | undefined>, aliasPath: string): string | null {
    const g = env.GATEWAY_URL;
    if (!g) return `${aliasPath} has no GATEWAY_URL, so the session would take the process's or SERVER's gateway; it must be ${ONEOFF_GATEWAY_URL}`;
    if (urlPort(g) === RUN_GATEWAY_PORT) return `${aliasPath} names the run's gateway (GATEWAY_URL=${g}); a one-off uses ${ONEOFF_GATEWAY_URL} only`;
    if (g !== ONEOFF_GATEWAY_URL) return `${aliasPath} has GATEWAY_URL=${g}, not the one-off gateway ${ONEOFF_GATEWAY_URL}`;
    const lite = proc.LITE_BOT_ENV;
    if (!lite) return `LITE_BOT_ENV is unset, so the lite runner would read bots/<login>/bot.env and publish to the run's gateway: ${VIA_WRAPPER}`;
    if (resolve(lite) !== resolve(aliasPath)) return `LITE_BOT_ENV is not ${aliasPath}, so the lite runner would read another env file: ${VIA_WRAPPER}`;
    if (proc.GATEWAY_URL !== ONEOFF_GATEWAY_URL) return `GATEWAY_URL in the environment is ${proc.GATEWAY_URL ?? 'unset'}, not ${ONEOFF_GATEWAY_URL}: ${VIA_WRAPPER}`;
    return null;
}

/**
 * The alias env, refused unless isolationRefusal passes. Every scored-side tool opens its session with
 * this env (openOneoff), never with loadBotEnv(<SCORED>) and never without `env`.
 */
export function loadOneoffEnv(proc: Record<string, string | undefined> = process.env, root: string = ROOT): BotEnv {
    const path = aliasEnvPath(root);
    if (!existsSync(path)) throw new Error(`no alias env at ${path}: ${VIA_WRAPPER}, which writes it`);
    const env = loadBotEnv(ONEOFF_ALIAS, join(root, 'bots'));
    const why = isolationRefusal(env, proc, path);
    if (why) throw new Error(why);
    return env;
}

/** Open SCORED's one-off session: the alias env, a lite client launched for it, nothing else. */
export function openOneoff(env: BotEnv, o: { pathfinding: boolean }): Promise<Session> {
    return openSession(ONEOFF_ALIAS, { env, client: 'lite', launch: true, pathfinding: o.pathfinding, readyTimeoutMs: 90_000 });
}

/** Replaces account names in text, case-blind, with `_` and spaces alike (the world shows `_` as a space). */
export class Redactor {
    private readonly names: { re: RegExp; as: string }[] = [];

    add(name: string, as: string): void {
        const words = name.trim().split(/[\s_]+/).filter(Boolean);
        if (!words.length) return;
        const pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s_]+');
        this.names.push({ re: new RegExp(pattern, 'gi'), as });
    }

    apply(text: string): string {
        return this.names.reduce((t, n) => t.replace(n.re, n.as), text);
    }
}

/** The one-off ledger: one JSON line per event, `{t, one_off, k, v}`, redacted, printed and appended. */
export class OneoffLedger {
    constructor(
        readonly kind: string,
        readonly file: string | null,
        readonly redact: Redactor,
        private readonly print: (line: string) => void = line => console.log(line),
        private readonly now: () => Date = () => new Date()
    ) {}

    out(k: string, v: unknown): void {
        const line = this.redact.apply(JSON.stringify({ t: this.now().toISOString(), one_off: this.kind, k, v: v ?? null }));
        this.print(line);
        if (this.file) appendFileSync(this.file, line + '\n');
    }
}

export type ById = Record<number, number>;

/** Item counts by obj id (inventory or equipment), every slot of an id summed. */
export function byId(items: readonly (InventoryItem | null | undefined)[] | undefined): ById {
    const m: ById = {};
    for (const i of items ?? []) if (i) m[i.id] = (m[i.id] ?? 0) + i.count;
    return m;
}

export function usedSlots(items: readonly (InventoryItem | null | undefined)[] | undefined): number {
    return (items ?? []).filter(Boolean).length;
}

export const PACK_SLOTS = 28;

export function freeSlots(items: readonly (InventoryItem | null | undefined)[] | undefined): number {
    return PACK_SLOTS - usedSlots(items);
}

export interface PackChange {
    id: number;
    before: number;
    after: number;
    want: number;
}

/** Every id whose count after is not the one expected: `expect`'s for the ids it names, else unchanged. */
export function packChanges(pre: ById, post: ById, expect: ById): PackChange[] {
    const ids = new Set([...Object.keys(pre), ...Object.keys(post), ...Object.keys(expect)].map(Number));
    const out: PackChange[] = [];
    for (const id of [...ids].sort((a, b) => a - b)) {
        const before = pre[id] ?? 0;
        const after = post[id] ?? 0;
        const want = expect[id] ?? before;
        if (after !== want) out.push({ id, before, after, want });
    }
    return out;
}

export interface Tile {
    x: number;
    z: number;
    level: number;
}

/** `X,Z` or `X,Z,LEVEL` (level 0 when omitted). */
export function parseTile(s: string | undefined): Tile | null {
    if (!s) return null;
    const m = /^(\d+),(\d+)(?:,([0-3]))?$/.exec(s.trim());
    return m ? { x: Number(m[1]), z: Number(m[2]), level: Number(m[3] ?? 0) } : null;
}

export function tileOf(s: BotWorldState | null | undefined): Tile | null {
    const p = s?.player;
    return p ? { x: p.worldX, z: p.worldZ, level: p.level } : null;
}

/** Chebyshev distance on one level; Infinity across levels. */
export function chebyshev(a: Tile, b: Tile): number {
    return a.level !== b.level ? Infinity : Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

/** Whether `ps -eo comm,args` shows run.ts (a bun whose arguments run speedrun/run.ts). */
export function runTsRunning(psText: string): boolean {
    return psText.split('\n').some(line => {
        const [comm, ...args] = line.trim().split(/\s+/);
        return comm === 'bun' && /speedrun\/run\.ts/.test(args.join(' '));
    });
}

/** One /playerpositions entry: the world's player list, with each player's tile. */
export interface RosterEntry {
    name: string;
    x: number;
    z: number;
    level: number;
}

export async function fetchRoster(origin: string, fetchImpl: typeof fetch = fetch, timeoutMs = 15_000): Promise<RosterEntry[] | null> {
    try {
        const res = await fetchImpl(`${origin}/playerpositions`, { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) return null;
        const body = (await res.json()) as unknown;
        const players = Array.isArray(body) ? body : (body as { players?: unknown } | null)?.players;
        if (!Array.isArray(players)) return null;
        return players.filter((p): p is RosterEntry => typeof p?.name === 'string');
    } catch {
        return null;
    }
}

export function listedIn(roster: readonly RosterEntry[], account: string): boolean {
    const key = playerNameKey(account);
    return roster.some(p => playerNameKey(p.name) === key);
}

/** sha256 of the lowercased roster name, hex: how a courier is named in a command without its name. */
export function nameHash(name: string): string {
    return createHash('sha256').update(name.toLowerCase()).digest('hex');
}

/** How far from the meet tile a courier may stand at preflight. */
export const COURIER_WITHIN = 6;

/**
 * The courier named by `hash` (a prefix of nameHash, 6+ hex digits) on the player list: exactly one
 * match, within COURIER_WITHIN tiles of `meet`; else why not. Every match is redacted to COURIER.
 */
export function findCourier(roster: readonly RosterEntry[], hash: string, meet: Tile, redact: Redactor): { name: string; line: Record<string, unknown> } | string {
    const h = hash.toLowerCase();
    if (!/^[0-9a-f]{6,64}$/.test(h)) return 'the courier hash must be 6 to 64 hex digits';
    const matches = roster.filter(p => nameHash(p.name).startsWith(h));
    for (const m of matches) redact.add(m.name, 'COURIER');
    if (matches.length !== 1) return `${matches.length} listed players match the courier hash; need exactly 1`;
    const m = matches[0]!;
    const dist = chebyshev({ x: m.x, z: m.z, level: m.level }, meet);
    if (dist > COURIER_WITHIN) return `the courier is ${Number.isFinite(dist) ? `${dist} tiles` : 'on another level'} from the meet tile (at most ${COURIER_WITHIN})`;
    return { name: m.name, line: { courierMatches: 1, courier: { x: m.x, z: m.z, level: m.level, distFromMeet: dist } } };
}

/** `--name=value` from argv. */
export function flag(argv: readonly string[], name: string): string | undefined {
    return argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

/** A non-negative integer flag; undefined when absent, NaN when malformed. */
export function intFlag(argv: readonly string[], name: string): number | undefined {
    const v = flag(argv, name);
    if (v === undefined) return undefined;
    return /^\d+$/.test(v) ? Number(v) : NaN;
}

export interface OneoffIO {
    /** The world's player list, or null when it did not answer. */
    roster(): Promise<RosterEntry[] | null>;
    /** `ps -eo comm,args`. */
    ps(): string;
    open(env: BotEnv, o: { pathfinding: boolean }): Promise<Session>;
    logout(s: Session): Promise<LogoutResult>;
    abandon(s: Session): Promise<AbandonResult | null>;
    close(s: Session): Promise<void>;
    sleep(ms: number): Promise<void>;
}

export function liveIO(env: BotEnv): OneoffIO {
    const origin = demoOrigin(env.SERVER);
    return {
        roster: () => fetchRoster(origin),
        ps: () => Bun.spawnSync(['ps', '-eo', 'comm,args']).stdout.toString(),
        open: openOneoff,
        logout: s => logoutClean(s),
        abandon: s => abandonClient(s),
        close: closeSession,
        sleep,
    };
}

export interface PreCtx {
    roster: readonly RosterEntry[];
    redact: Redactor;
}

export interface ActCtx {
    session: Session;
    state(): BotWorldState;
    out(k: string, v: unknown): void;
    redact: Redactor;
    waitTicks(n: number): Promise<void>;
    sleep(ms: number): Promise<void>;
    /** The world's player list now (a courier that arrives after the login), or null. */
    roster(): Promise<RosterEntry[] | null>;
    /** Ticks since the login line. */
    sinceLogin(): number;
}

export interface OneoffSpec {
    /** The ledger's `one_off` (e.g. `drop-1351`). */
    kind: string;
    argv: readonly string[];
    /** Warm the pathfinder (bot.walkTo needs it). Default false. */
    pathfinding?: boolean;
    /** Where SCORED must stand once in the world, within `within` tiles on the same level; else nothing is done. */
    at?: { tile: Tile; within: number };
    /** The tool's own checks before any login; fields join the preflight line, a string refuses. */
    preflight?: (c: PreCtx) => Promise<Record<string, unknown> | string>;
    /** The one-off itself; false when its check failed (it writes the CHECK-FAIL line). */
    act(c: ActCtx): Promise<boolean>;
}

export interface RunOneoffOptions {
    proc?: Record<string, string | undefined>;
    root?: string;
    scoredFile?: string;
    io?: (env: BotEnv) => OneoffIO;
    print?: (line: string) => void;
    now?: () => Date;
    /** Player-list reads after the logout, 2 s apart, before OFFLINE-UNCONFIRMED (default 20: 40 s). */
    offlinePolls?: number;
}

function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/**
 * A scored-side one-off, start to finish; returns the exit code (EXIT). In order, each step a ledger
 * line: refuse unless the alias env and this process are isolated (STOP); preflight: SCORED not on
 * the world's player list, run.ts not running, the tool's own checks (STOP); without --go stop there
 * (DRY); open the session on 7781 (OPEN-ERROR); the login tile against `at` (CHECK-FAIL); the act;
 * logoutClean, and the client abandoned (clicked out, then killed) if that is unconfirmed; then the
 * player list polled until SCORED is gone (offline, else OFFLINE-UNCONFIRMED).
 */
export async function runOneoff(spec: OneoffSpec, o: RunOneoffOptions = {}): Promise<number> {
    const proc = o.proc ?? process.env;
    const redact = new Redactor();
    const now = o.now ?? (() => new Date());
    const ledger = new OneoffLedger(spec.kind, proc.ONEOFF_LEDGER || null, redact, o.print, now);
    let acct: string;
    let env: BotEnv;
    try {
        acct = readScoredAccount(o.scoredFile ?? SCORED_ACCOUNT_FILE);
        redact.add(acct, 'SCORED');
        env = loadOneoffEnv(proc, o.root ?? ROOT);
        redact.add(env.BOT_USERNAME, 'SCORED');
        if (playerNameKey(env.BOT_USERNAME) !== playerNameKey(acct)) throw new Error(`the alias env's BOT_USERNAME is not the account in ${o.scoredFile ?? SCORED_ACCOUNT_FILE}`);
    } catch (e) {
        ledger.out('STOP', message(e));
        return EXIT.stop;
    }
    const io = (o.io ?? liveIO)(env);

    const roster = await io.roster();
    const runts = runTsRunning(io.ps());
    const scoredOnline = roster ? listedIn(roster, acct) : null;
    const guard = roster === null ? "the world's player list did not answer, so SCORED's absence is unknown" : scoredOnline ? 'SCORED is in the world' : runts ? 'run.ts is running' : null;
    const tool = !guard && spec.preflight ? await spec.preflight({ roster: roster!, redact }) : {};
    ledger.out('preflight', { scoredOnline, runts, online: roster?.length ?? null, ...(typeof tool === 'string' ? { refused: tool } : tool) });
    if (guard || typeof tool === 'string') {
        ledger.out('STOP', guard ?? tool);
        return EXIT.stop;
    }
    if (!spec.argv.includes('--go')) {
        ledger.out('DRY', 'preflight ok; rerun with --go');
        return EXIT.ok;
    }

    let code: number = EXIT.ok;
    let s: Session | null = null;
    try {
        s = await io.open(env, { pathfinding: spec.pathfinding ?? false });
    } catch (e) {
        ledger.out('OPEN-ERROR', message(e));
        code = EXIT.open;
    }
    if (s) {
        const session = s;
        const state = () => session.sdk.getState() as BotWorldState;
        const loginTick = state()?.tick ?? 0;
        try {
            const st = state();
            const tile = tileOf(st);
            ledger.out('login', { tick: st?.tick ?? null, inGame: st?.inGame ?? false, at: tile ? [tile.x, tile.z, tile.level] : null, utc: now().toISOString() });
            const away = spec.at && (!tile || chebyshev(tile, spec.at.tile) > spec.at.within);
            if (away) {
                ledger.out('CHECK-FAIL', { why: `not within ${spec.at!.within} tiles of the expected tile; nothing done`, expected: spec.at!.tile, at: tile });
                code = EXIT.check;
            } else {
                const ok = await spec.act({
                    session,
                    state,
                    out: (k, v) => ledger.out(k, v),
                    redact,
                    waitTicks: n => io.sleep(n * tickMs()),
                    sleep: ms => io.sleep(ms),
                    roster: () => io.roster(),
                    sinceLogin: () => (state()?.tick ?? loginTick) - loginTick,
                });
                if (!ok) code = EXIT.check;
            }
        } catch (e) {
            ledger.out('ERROR', message(e));
            code = EXIT.error;
        }
        let out = false;
        try {
            const lo = await io.logout(session);
            ledger.out('logout', { ...lo, tick: state()?.tick ?? null, utc: now().toISOString() });
            out = lo.ok;
        } catch (e) {
            ledger.out('LOGOUT-ERROR', message(e));
            code = EXIT.logout;
        }
        if (!out) {
            // A live lite runner with nothing driving it keeps the body in the world indefinitely.
            const ab = await io.abandon(session).catch(e => ({ ok: false, sends: 0, takeovers: 0, wallMs: 0, reason: message(e) }) as AbandonResult);
            ledger.out('abandon', ab ? describeAbandon(ab) : 'no running client');
        }
        await io.close(session).catch(() => {});
    }

    const polls = o.offlinePolls ?? 20;
    for (let i = 0; i < polls; i++) {
        const q = await io.roster();
        if (q && !listedIn(q, acct)) {
            ledger.out('offline', { confirmed: true, after_s: i * 2 });
            return code;
        }
        if (i < polls - 1) await io.sleep(2_000);
    }
    ledger.out('OFFLINE-UNCONFIRMED', `still listed (or no player list) after ${polls * 2} s`);
    return code === EXIT.ok ? EXIT.offline : code;
}
