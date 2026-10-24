#!/usr/bin/env bun
// The ONLY launch path for a scored-side one-off: host's ~/rs-run/tools/oneoff.sh of attempts 3-4,
// ported so its isolation check is tested. From an ssh shell on the run host:
//
//   bun speedrun/tools/oneoff.ts [--run-dir=DIR] [--run-gateway-log=FILE] <tool> [tool args...]
//
// <tool> names a script in speedrun/tools/oneoff/ (read, drop, receive, walk); nothing else is run.
// Without --go in the tool args the tool runs its preflight only and logs nothing in. In order:
// 1. refuses (exit 9, nothing raised) while run.ts runs, while 7781 is taken, while the alias dir is
//    left over from an earlier one-off, or without SCORED's env, ~/rs-run/.scored-account or the run
//    gateway's log;
// 2. raises its own gateway on 7781 as `tmux -L run` session gw1, bounded by `timeout` (RUN-HOST.md,
//    "Every launch is reaped by its own hard timeout");
// 3. writes the alias env bots/host-oneoff/bot.env: SCORED's bot.env with GATEWAY_URL=ws://127.0.0.1:7781
//    (dir 700, file 600);
// 4. counts "Bot connected" in the run gateway's log (7780; run-gate.ts `up` writes ~/rs-run/gateway.log),
//    then runs the tool under `timeout` with LITE_BOT_ENV, GATEWAY_URL and ONEOFF_LEDGER set. Only its
//    JSON ledger lines and usage reach the terminal, redacted; all its output, redacted, goes to
//    <run dir>/oneoff-<UTC>.out;
// 5. counts again: unchanged prints `7780 untouched`, anything else `ISOLATION BREACH` and exit 10;
// 6. removes the alias dir, kills gw1, and checks that 7781 closed and the dir is gone (exit 11 if not);
// 7. appends a `wrapper` line to <run dir>/oneoff-drop.jsonl: the tool, its exit, the two gateways'
//    counts, login and logout UTC and the ticks in the world.
// SIGINT, SIGTERM or SIGHUP while the tool runs is passed on to it as SIGTERM (session.ts then clicks
// SCORED out) and the teardown still runs.

import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { basename, dirname, join } from 'path';
import { RUN_DIR } from '../helpers/altar-cue';
import {
    aliasEnvPath,
    EXIT,
    flag,
    LEDGER_FILE,
    ONEOFF_GATEWAY_URL,
    ONEOFF_PORT,
    readScoredAccount,
    Redactor,
    RUN_GATEWAY_PORT,
    runTsRunning,
} from '../lib/oneoff';
import { ROOT } from '../lib/session';

export const WRAPPER_EXIT = { refused: 9, breach: 10, teardown: 11 } as const;
/** The one-off gateway's `timeout` bound; the tool's is shorter, so the gateway outlives it. */
export const GATEWAY_BOUND = '35m';
export const TOOL_BOUND = '30m';
export const GATEWAY_SESSION = 'gw1';
export const BOT_CONNECTED = 'Bot connected';

/** Lines of a gateway log that record a lite client connecting (gateway.ts `Bot connected: ...`). */
export function countBotConnected(log: string): number {
    return log.split('\n').filter(l => l.includes(BOT_CONNECTED)).length;
}

export interface IsolationVerdict {
    breach: boolean;
    line: string;
}

/** The run gateway's "Bot connected" count before and after the tool: any change is a breach. */
export function isolationVerdict(before: number, after: number): IsolationVerdict {
    if (after === before) return { breach: false, line: `${RUN_GATEWAY_PORT} untouched (Bot connected count ${after})` };
    const d = after - before;
    return {
        breach: true,
        line: d > 0 ? `ISOLATION BREACH: ${RUN_GATEWAY_PORT} gained ${d} bot connection(s)` : `ISOLATION BREACH: ${RUN_GATEWAY_PORT}'s Bot connected count went from ${before} to ${after} (log replaced?)`,
    };
}

/** SCORED's bot.env with its GATEWAY_URL replaced by the one-off gateway's. */
export function aliasEnvText(scoredEnv: string): string {
    const keep = scoredEnv.split('\n').filter(l => !/^\s*GATEWAY_URL\s*=/.test(l));
    while (keep.length && keep[keep.length - 1]!.trim() === '') keep.pop();
    return [...keep, `GATEWAY_URL=${ONEOFF_GATEWAY_URL}`, ''].join('\n');
}

/** The tool's script path: a bare name (or name.ts) in speedrun/tools/oneoff/; null for anything else. */
export function resolveTool(arg: string, root: string = ROOT): string | null {
    const name = arg.replace(/\.ts$/, '');
    if (!/^[a-z][a-z0-9-]*$/.test(basename(name)) || (name.includes('/') && dirname(name).replace(/^\.\//, '') !== 'speedrun/tools/oneoff')) return null;
    const path = join(root, 'speedrun', 'tools', 'oneoff', `${basename(name)}.ts`);
    return existsSync(path) ? path : null;
}

export function gatewayCommand(o: { bound: string; bun: string; log: string }): string {
    return `exec timeout --kill-after=30s ${o.bound} env AGENT_PORT=${ONEOFF_PORT} GATEWAY_HOSTNAME=127.0.0.1 ${o.bun} run gateway.ts >>${o.log} 2>&1`;
}

/** What the tool's ledger lines say about its stay in the world. */
export interface StaySummary {
    kind: string | null;
    loginUtc: string | null;
    loginTick: number | null;
    logoutUtc: string | null;
    lastInWorldTick: number | null;
    ticksInWorld: number | null;
    offline: 'confirmed' | 'UNCONFIRMED' | null;
}

export function summarize(lines: readonly string[]): StaySummary {
    const s: StaySummary = { kind: null, loginUtc: null, loginTick: null, logoutUtc: null, lastInWorldTick: null, ticksInWorld: null, offline: null };
    for (const line of lines) {
        let j: { one_off?: unknown; k?: unknown; v?: Record<string, unknown> | null };
        try {
            j = JSON.parse(line);
        } catch {
            continue;
        }
        if (typeof j.one_off === 'string') s.kind ??= j.one_off;
        const v = j.v && typeof j.v === 'object' ? j.v : {};
        const num = (x: unknown) => (typeof x === 'number' ? x : null);
        if (j.k === 'login') {
            s.loginUtc = typeof v.utc === 'string' ? v.utc : null;
            s.loginTick = num(v.tick);
        } else if (j.k === 'logout') {
            s.logoutUtc = typeof v.utc === 'string' ? v.utc : null;
            s.lastInWorldTick = num(v.lastInWorldTick) ?? num(v.tick);
        } else if (j.k === 'offline') s.offline = 'confirmed';
        else if (j.k === 'OFFLINE-UNCONFIRMED') s.offline = 'UNCONFIRMED';
    }
    if (s.loginTick !== null && s.lastInWorldTick !== null && s.lastInWorldTick >= s.loginTick) s.ticksInWorld = s.lastInWorldTick - s.loginTick;
    return s;
}

export interface WrapperIO {
    ps(): string;
    /** Whether something listens on 127.0.0.1:`port` (`ss -Hltn`). */
    listening(port: number): Promise<boolean>;
    /** `tmux -L run <args>`; its exit code. */
    tmux(args: string[]): Promise<number>;
    /** Run the tool to its exit; every output line to onLine. `onSpawn` gets a way to signal it. */
    runTool(argv: string[], o: { cwd: string; env: Record<string, string>; onLine: (line: string) => void; onSpawn: (kill: (sig: NodeJS.Signals) => void) => void }): Promise<number>;
    sleep(ms: number): Promise<void>;
    now(): Date;
    print(line: string): void;
    /** Install a handler for SIGINT, SIGTERM and SIGHUP; returns its removal. */
    onSignal(h: (sig: NodeJS.Signals) => void): () => void;
}

export interface WrapperOptions {
    root?: string;
    home?: string;
    runDir?: string;
    runGatewayLog?: string;
    bun?: string;
}

const USAGE = 'usage: bun speedrun/tools/oneoff.ts [--run-dir=DIR] [--run-gateway-log=FILE] <read|drop|receive|walk> [tool args...] [--go]';

function stamp(d: Date): string {
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

export async function runWrapper(argv: readonly string[], io: WrapperIO, o: WrapperOptions = {}): Promise<number> {
    const root = o.root ?? ROOT;
    const home = o.home ?? homedir();
    // Wrapper flags come before the tool; everything after it is the tool's.
    const at = argv.findIndex(a => !a.startsWith('--'));
    const own = at < 0 ? argv : argv.slice(0, at);
    const toolArg = at < 0 ? undefined : argv[at];
    const toolArgs = at < 0 ? [] : argv.slice(at + 1);
    const runDir = flag(own, 'run-dir') ?? o.runDir ?? RUN_DIR;
    const runLog = flag(own, 'run-gateway-log') ?? o.runGatewayLog ?? join(home, 'rs-run', 'gateway.log');
    const oneoffLog = join(home, 'rs-run', 'gateway-oneoff.log');
    const scoredFile = join(home, 'rs-run', '.scored-account');
    const bun = o.bun ?? process.execPath;
    const alias = aliasEnvPath(root);
    const aliasDir = dirname(alias);
    const ledgerFile = join(runDir, LEDGER_FILE);
    const say = (s: string) => io.print(s);
    const refuse = (why: string) => {
        say(`REFUSED: ${why}; nothing started`);
        return WRAPPER_EXIT.refused;
    };

    say(io.now().toISOString());
    if (!toolArg) {
        say(USAGE);
        return EXIT.usage;
    }
    const tool = resolveTool(toolArg, root);
    if (!tool) return refuse(`no one-off tool ${toolArg} in speedrun/tools/oneoff/`);
    let acct: string;
    try {
        acct = readScoredAccount(scoredFile);
    } catch (e) {
        return refuse(e instanceof Error ? e.message : String(e));
    }
    const redact = new Redactor();
    redact.add(acct, 'SCORED');
    const scoredEnv = join(root, 'bots', acct, 'bot.env');
    if (!existsSync(scoredEnv)) return refuse(`SCORED has no bot.env in ${join(root, 'bots')}`);
    if (runTsRunning(io.ps())) return refuse('run.ts is running');
    if (await io.listening(ONEOFF_PORT)) return refuse(`${ONEOFF_PORT} is taken`);
    if (existsSync(aliasDir)) return refuse(`${aliasDir} is left from an earlier one-off; check nothing uses it, then remove it`);
    if (!existsSync(runLog)) return refuse(`no run gateway log at ${runLog}, so the isolation check would have nothing to compare (--run-gateway-log=FILE)`);

    let interrupted: NodeJS.Signals | null = null;
    let killTool: ((sig: NodeJS.Signals) => void) | null = null;
    const offSignal = io.onSignal(sig => {
        interrupted ??= sig;
        say(`[oneoff] ${sig}: ${killTool ? 'stopping the tool (SIGTERM), then teardown' : 'teardown'}`);
        killTool?.('SIGTERM');
    });

    let toolExit: number | null = null;
    let verdict: IsolationVerdict | null = null;
    let runBefore: number | null = null;
    let runAfter: number | null = null;
    let oneoffSeen: number | null = null;
    const toolLines: string[] = [];
    try {
        await io.tmux(['new-session', '-d', '-s', GATEWAY_SESSION, '-c', join(root, 'server', 'gateway'), gatewayCommand({ bound: GATEWAY_BOUND, bun, log: oneoffLog })]);
        let up = false;
        for (let i = 0; i < 20 && !interrupted; i++) {
            await io.sleep(1_000);
            if ((up = await io.listening(ONEOFF_PORT))) break;
        }
        if (!up) {
            say(`one-off gateway not up${interrupted ? ` (${interrupted})` : ''}; see ${oneoffLog}`);
        } else if (!interrupted) {
            mkdirSync(aliasDir, { recursive: true, mode: 0o700 });
            chmodSync(aliasDir, 0o700);
            writeFileSync(alias, aliasEnvText(readFileSync(scoredEnv, 'utf8')), { mode: 0o600 });
            chmodSync(alias, 0o600);
            mkdirSync(runDir, { recursive: true });
            const outFile = join(runDir, `oneoff-${stamp(io.now())}.out`);
            const isoBefore = existsSync(oneoffLog) ? countBotConnected(readFileSync(oneoffLog, 'utf8')) : 0;
            runBefore = countBotConnected(readFileSync(runLog, 'utf8'));
            let hidden = 0;
            toolExit = await io.runTool(['timeout', '--kill-after=10s', TOOL_BOUND, bun, tool, ...toolArgs], {
                cwd: root,
                env: {
                    ...(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<string, string>),
                    PATH: `${dirname(bun)}:${process.env.PATH ?? ''}`,
                    LITE_BOT_ENV: alias,
                    GATEWAY_URL: ONEOFF_GATEWAY_URL,
                    ONEOFF_LEDGER: ledgerFile,
                },
                onLine: raw => {
                    const line = redact.apply(raw);
                    appendFileSync(outFile, line + '\n');
                    if (line.startsWith('{')) {
                        toolLines.push(line);
                        say(line);
                    } else if (line.startsWith('usage')) say(line);
                    else hidden++;
                },
                onSpawn: kill => {
                    killTool = kill;
                    if (interrupted) kill('SIGTERM');
                },
            });
            killTool = null;
            say(`TOOL_EXIT ${toolExit}${hidden ? ` (${hidden} other output line(s) in ${outFile})` : ''}`);
            runAfter = countBotConnected(readFileSync(runLog, 'utf8'));
            verdict = isolationVerdict(runBefore, runAfter);
            say(verdict.line);
            oneoffSeen = (existsSync(oneoffLog) ? countBotConnected(readFileSync(oneoffLog, 'utf8')) : 0) - isoBefore;
            say(`${ONEOFF_PORT} saw ${oneoffSeen} bot connection(s)`);
        }
    } finally {
        rmSync(aliasDir, { recursive: true, force: true });
        await io.tmux(['kill-session', '-t', GATEWAY_SESSION]);
        await io.sleep(2_000);
        offSignal();
    }
    const gatewayStopped = !(await io.listening(ONEOFF_PORT));
    const aliasRemoved = !existsSync(aliasDir);
    say(gatewayStopped ? 'one-off gateway stopped' : `${ONEOFF_PORT} STILL UP`);
    say(aliasRemoved ? 'alias dir removed' : 'ALIAS DIR STILL THERE');

    const stay = summarize(toolLines);
    let code: number = toolExit ?? WRAPPER_EXIT.refused;
    if (verdict?.breach) code = WRAPPER_EXIT.breach;
    else if ((!gatewayStopped || !aliasRemoved) && code === EXIT.ok) code = WRAPPER_EXIT.teardown;
    mkdirSync(runDir, { recursive: true });
    const summary = {
        t: io.now().toISOString(),
        one_off: stay.kind ?? basename(tool, '.ts'),
        k: 'wrapper',
        v: {
            tool: basename(tool),
            go: toolArgs.includes('--go'),
            toolExit,
            exit: code,
            interrupted,
            runGateway: { before: runBefore, after: runAfter, breach: verdict?.breach ?? null },
            oneoffGateway: { botConnected: oneoffSeen },
            loginUtc: stay.loginUtc,
            logoutUtc: stay.logoutUtc,
            loginTick: stay.loginTick,
            lastInWorldTick: stay.lastInWorldTick,
            ticksInWorld: stay.ticksInWorld,
            offline: stay.offline,
            teardown: { gatewayStopped, aliasRemoved },
        },
    };
    appendFileSync(ledgerFile, redact.apply(JSON.stringify(summary)) + '\n');
    say(io.now().toISOString());
    return code;
}

async function capture(argv: string[]): Promise<{ code: number; out: string }> {
    const p = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe' });
    const [out] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { code: await p.exited, out };
}

async function pump(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    let buf = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
            onLine(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
        }
    }
    if (buf) onLine(buf);
}

export const liveWrapperIO: WrapperIO = {
    ps: () => Bun.spawnSync(['ps', '-eo', 'comm,args']).stdout.toString(),
    listening: async port => (await capture(['ss', '-Hltn'])).out.split('\n').some(l => l.includes(`:${port} `)),
    tmux: async args => (await capture(['tmux', '-L', 'run', ...args])).code,
    runTool: async (argv, o) => {
        const p = Bun.spawn(argv, { cwd: o.cwd, env: o.env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
        o.onSpawn(sig => p.kill(sig));
        await Promise.all([pump(p.stdout, o.onLine), pump(p.stderr, o.onLine)]);
        return await p.exited;
    },
    sleep: ms => Bun.sleep(ms),
    now: () => new Date(),
    print: line => console.log(line),
    onSignal: h => {
        const sigs: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
        for (const s of sigs) process.on(s, h);
        return () => {
            for (const s of sigs) process.off(s, h);
        };
    },
};

if (import.meta.main) process.exit(await runWrapper(process.argv.slice(2), liveWrapperIO));
