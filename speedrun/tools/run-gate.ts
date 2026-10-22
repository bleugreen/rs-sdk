// Run day on the two Ashburn machines: bring up the tab stack, gate both machines in the same
// minute, choose one, and hand the recorded display over from the gate's probe tab to SCORED's
// tab. It replaces docs/speedrun/RUN-HOST.md steps 3, 5, 5a, 6 and 7's hand-run commands; the
// rest of the runbook (step 0's run commit, step 4's helpers, steps 8-9) stays as it is.
//
// On the Mac (or any executor holding the fleet keys), with RS_RUN_HOST, RS_TWIN_HOST and
// RS_RUN_TAILNET set locally from cairn://p/rs/host (never committed, tenet 20):
//
//   bun speedrun/tools/run-gate.ts up      [--machines=run,twin] [--rehearsal] [--claim=OWNER]
//   bun speedrun/tools/run-gate.ts gate    --gate-run=ACCOUNT --gate-twin=ACCOUNT [--machines=run,twin]
//                                          [--minutes=5] [--rehearsal] [--claim=OWNER] [--rehearse=CASE]
//   bun speedrun/tools/run-gate.ts handoff --machine=run|twin --scored-env=PATH [--max-gate-age=20]
//                                          [--cap=80] [--rehearsal] [--claim=OWNER]
//
//   common: [--remote-checkout=rs-sdk] (relative to the machine's $HOME) [--log-dir=DIR] [--display=:10]
//
// Each command runs `on-machine <command>` on the machines over ssh (the exact ssh options of
// RUN-HOST.md "Reaching them"), detached under its own `timeout`, so a dropped ssh line never
// stops a step halfway: the on-machine run finishes into ~/rs-run/gate-<UTC>/steps.log on the
// machine, and the Mac prints the same lines prefixed [run] or [twin] and keeps a copy in
// --log-dir (default ~/rs-run-gate). `gate` runs both machines in parallel, prints (a)-(d) per
// machine, chooses (RUN-HOST.md step 5a.2: the run host when both pass, the twin only on the
// tiebreak) and writes choice.json; `handoff` refuses a machine the latest choice did not name, or
// a choice older than --max-gate-age minutes. Between the two, step 5a.4-5a.5's roster moves and
// step 7's login count happen through rs/117's launcher, as before.
//
// Main's recording rulings (cairn://p/rs/main/messages, 18:16 and 19:08 PDT 2026-10-21) are hard
// checks here:
// 1. `gate` logs the probe tab out and then kills the gate Chrome UNCONDITIONALLY, whether or not
//    the logout was confirmed: one Chrome per profile, so a gate Chrome left up would own SCORED's
//    window and kill it at the gate tab's 15-minute bound.
// 2. after the kill, and again at the start of `handoff`: no `tmux -L run` session `chrome`, no
//    process on rs-run/chrome-profile, no Bot Client window on the display.
// 3. before SCORED's login: exactly one Bot Client window, 1920 wide (step 3's xwininfo check).
// 4. the recording runs before SCORED's login, and a live frame (an x11grab of the display, as the
//    recording grabs it) matches the page's own screenshot (speedrun/lib/display.ts frameShows,
//    mean gray difference at most 12/255) with the run tab the window in front. It is a pass line
//    beside (a)-(d), checked before the login and again once SCORED is in game.
// 5. nothing in this tool raises a window on a display that has a run tab: `gate` and `handoff`
//    refuse to start while any Bot Client window or run-profile Chrome exists, so a mid-run or
//    after-run probe that needs a tab can only run on the machine not chosen.
// Any failed precondition or pass line stops with a non-zero exit and one `STOP:` line. Nothing
// here repairs the recorded display: no window is raised, closed or retried by this tool except
// the gate Chrome's unconditional kill, which is the rule itself.
//
// Exit codes: 0 pass, 1 a pass line failed (or no machine passes), 2 a precondition or a tool
// failed (STOP), 3 re-measure ((c) failed, or (d) marginal).
//
// SCORED's name is never printed: `handoff` reads it from --scored-env and relabels every line it
// prints, its frames and its logs as SCORED.
//
// --rehearsal: 30-minute bounds instead of the run's 9 h, `rehearsal-` recordings, and it requires
// --claim with an owner other than host or run. --rehearse=unconfirmed-logout skips the gate tab's
// logoutClean and treats the logout as unconfirmed, to show the unconditional kill;
// --rehearse=kept-chrome also skips the kill (the old `logout && kill` behaviour on an unconfirmed
// logout), to show the closed-window checks stop the gate. Both only with --rehearsal.

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { DIRECT_RULE, directDecision, type DirectVerdict, verdictText } from '../lib/hostgate-verdict';

// ------------------------------------------------------------------ fixed names (RUN-HOST.md "Names and ports")

const HOME = homedir();
const ROOT = resolve(import.meta.dir, '../..');
const PROFILE = join(HOME, 'rs-run/chrome-profile');
const CDP = 'http://127.0.0.1:9222';
const PAGE = 'http://127.0.0.1:8899';
const DEMO = 'rs-sdk-demo.fly.dev';
const RECORD_WIDTH = 1920;
const GATE_TAB_BOUND = '15m';
const RUN_BOUND = '9h';
const REHEARSAL_BOUND = '30m';
/** The six Chrome flags step 3 checks on the browser process. */
export const CHROME_FLAGS = [
    'disable-background-timer-throttling',
    'disable-renderer-backgrounding',
    'disable-backgrounding-occluded-windows',
    'start-maximized',
    'remote-debugging-port=9222',
    `user-data-dir=${PROFILE}`,
] as const;

// ------------------------------------------------------------------ pure parts (run-gate.test.ts)

export type Machine = 'run' | 'twin';
export const MACHINES: readonly Machine[] = ['run', 'twin'];

export class Stop extends Error {
    constructor(
        message: string,
        readonly code = 2
    ) {
        super(message);
    }
}

export interface XwinWindow {
    id: string;
    name: string;
    width: number;
    height: number;
}

/** The Bot Client windows in `xwininfo -root -tree` output (step 3's check reads the same lines). */
export function botClientWindows(tree: string): XwinWindow[] {
    const out: XwinWindow[] = [];
    for (const line of tree.split('\n')) {
        const m = line.match(/^\s*(0x[0-9a-f]+) "((?:[^"\\]|\\.)*)":.*?\s(\d+)x(\d+)[+-]\d+[+-]\d+/i);
        if (!m || !/Bot Client/.test(m[2]!)) continue;
        out.push({ id: m[1]!, name: m[2]!, width: Number(m[3]), height: Number(m[4]) });
    }
    return out;
}

/** Ruling 3: exactly one Bot Client window on the display, `width` wide. Null when it holds. */
export function oneWindowProblem(ws: readonly XwinWindow[], width = RECORD_WIDTH): string | null {
    if (ws.length !== 1) return `${ws.length} Bot Client windows on the display, not exactly one${ws.length ? ` (${ws.map(w => `${w.width}x${w.height}`).join(', ')})` : ''}`;
    if (ws[0]!.width !== width) return `the Bot Client window is ${ws[0]!.width}x${ws[0]!.height}, not ${width} wide (not maximised)`;
    return null;
}

export interface LoopsSummary {
    lowest: number;
    median: number;
    highest: number;
    samples: number;
}

/** (d) from runhost-loops.ts's samples: lowest / median / highest 10-second p10, as its summary line. */
export function loopsSummary(samples: ReadonlyArray<{ loopsP10?: unknown }>): LoopsSummary | null {
    const v = samples.map(s => s.loopsP10).filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    return { lowest: v[0]!, median: v[Math.floor((v.length - 1) / 2)]!, highest: v[v.length - 1]!, samples: v.length };
}

/** What the direct CLI's --json file gives the gate: (a), (b), (c) and the players online. */
export interface DirectRead {
    onTime: number;
    trials: number;
    steadiness: { p90: number; catchUpsPerMinute: number } | null;
    players: number | null;
    logoutOk: boolean | null;
}

export function parseDirectJson(text: string): DirectRead {
    const j = JSON.parse(text) as {
        result?: { onTime?: number; trials?: number; steadiness?: { p90?: number; catchUpsPerMinute?: number } };
        vantage?: { players?: number };
        logout?: { ok?: boolean };
    };
    const r = j.result;
    if (!r || typeof r.onTime !== 'number' || typeof r.trials !== 'number') throw new Error('the direct gate wrote no probe result');
    const s = r.steadiness;
    return {
        onTime: r.onTime,
        trials: r.trials,
        steadiness: s && typeof s.p90 === 'number' && typeof s.catchUpsPerMinute === 'number' ? { p90: s.p90, catchUpsPerMinute: s.catchUpsPerMinute } : null,
        players: j.vantage?.players ?? null,
        logoutOk: typeof j.logout?.ok === 'boolean' ? j.logout.ok : null,
    };
}

/** pass and marginal may start; re-measure and fail may not; not-probed: a precondition stopped it. */
export type GateStatus = 'pass' | 'marginal' | 're-measure' | 'fail' | 'not-probed';

export interface MachineGate {
    machine: string;
    startedUtc: string;
    endUtc: string;
    status: GateStatus;
    a: { onTime: number; trials: number; passAt: number; floorAt: number } | null;
    b: { p90: number } | null;
    c: { perMinute: number } | null;
    d: LoopsSummary | null;
    players: number | null;
    /** confirmed: logoutClean saw the page out of game. The window is killed either way. */
    gateLogout: 'confirmed' | 'unconfirmed' | 'not-run';
    failures: string[];
}

export const startable = (s: GateStatus | undefined) => s === 'pass' || s === 'marginal';

/**
 * The machine's verdict on tenet 12's rule, through hostgate-verdict's directDecision with (d) as
 * the lowest 10-second sample. RUN-HOST.md step 6 reads a (d) whose lowest sample is under 50
 * but whose median is not as marginal, to re-measure; a median under 50 fails. (d) not measured
 * is never a pass.
 */
export function machineVerdict(direct: DirectRead, loops: LoopsSummary | null, opts: { requireLoops?: boolean } = {}): { status: GateStatus; verdict: DirectVerdict; failures: string[] } {
    const verdict = directDecision({ onTime: direct.onTime, trials: direct.trials, steadiness: direct.steadiness, loopRateP10: loops?.lowest ?? null });
    let failures = [...verdict.failures];
    let status: GateStatus;
    if (verdict.status === 're-measure') status = 're-measure';
    else if (verdict.status === 'throttled' && loops && loops.median >= DIRECT_RULE.minLoopRateP10) {
        status = 're-measure';
        failures = [`(d) marginal: lowest sample ${loops.lowest}/s under ${DIRECT_RULE.minLoopRateP10}, median ${loops.median}/s, re-measure`, ...failures.filter(f => !f.startsWith('tab throttled'))];
    } else if (verdict.status === 'throttled' || verdict.status === 'investigate') status = 'fail';
    else status = verdict.status;
    if (!loops && (opts.requireLoops ?? true) && startable(status)) {
        status = 'fail';
        failures.push('(d) not measured');
    }
    return { status, verdict, failures };
}

/**
 * RUN-HOST.md step 5a.2. One passes: start on it. Both pass: the run host, unless it passed only
 * at the margin ((a) under 60 of 60, (c) above 1 a minute, i.e. at the line of 2, or a (d) sample
 * under 60) while the twin read (a) 60 of 60 and (c) at most 1. Neither: no start.
 */
export function choose(gates: Partial<Record<Machine, MachineGate | null>>): { machine: Machine | null; reason: string } {
    const run = gates.run ?? null;
    const twin = gates.twin ?? null;
    const ok = (g: MachineGate | null): g is MachineGate => !!g && startable(g.status);
    const why = (m: Machine, g: MachineGate | null) => `${m} ${g ? `${g.status}${g.failures.length ? ` (${g.failures.join('; ')})` : ''}` : 'not gated'}`;
    if (ok(run) && ok(twin)) {
        const runMargin = [
            run.a && run.a.onTime < run.a.passAt ? `(a) ${run.a.onTime}/${run.a.trials}` : '',
            run.c && run.c.perMinute > 1 ? `(c) ${run.c.perMinute}/min` : '',
            run.d && run.d.lowest < 60 ? `(d) lowest ${run.d.lowest}/s` : '',
        ].filter(Boolean);
        const twinClean = !!twin.a && twin.a.onTime >= twin.a.passAt && !!twin.c && twin.c.perMinute <= 1;
        if (runMargin.length && twinClean) return { machine: 'twin', reason: `both pass; the run host only at the margin (${runMargin.join(', ')}) and the twin clean: the tiebreak picks the twin` };
        return { machine: 'run', reason: runMargin.length ? `both pass; the run host at the margin (${runMargin.join(', ')}) but the twin not clearly better: the run host, the default` : 'both pass: the run host, the default' };
    }
    if (ok(run)) return { machine: 'run', reason: `only the run host passes; ${why('twin', twin)}` };
    if (ok(twin)) return { machine: 'twin', reason: `only the twin passes; ${why('run', run)}` };
    return { machine: null, reason: `no machine passes: ${why('run', run)}; ${why('twin', twin)}` };
}

export interface ClaimStatus {
    free: boolean;
    owner: string | null;
    live: boolean;
    preempted: boolean;
    /** Our accounts online now, as rs-claim counts them (tenet 16); null when it could not count. */
    ours: number | null;
}

/** `rs-claim status`: the holder line, an optional PREEMPTED line, and `N of ours online of M`. */
export function parseClaimStatus(text: string): ClaimStatus {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const first = lines[0] ?? '';
    const free = first === 'free';
    const holder = free ? null : first.match(/^(\S+) logins=\S+ until=\S+ \((live|STALE)\)/);
    const n = text.match(/(\d+) of ours online of \d+/);
    return {
        free,
        owner: holder?.[1] ?? null,
        live: holder?.[2] === 'live',
        preempted: /PREEMPTED/.test(text),
        ours: n ? Number(n[1]) : null,
    };
}

/** Replace an account's name (and the in-game form, underscores as spaces) with `label`. */
export function relabel(text: string, name: string | null, label: string): string {
    if (!name) return text;
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const forms = [...new Set([name, name.replace(/_/g, ' ')])].map(esc).join('|');
    return text.replace(new RegExp(forms, 'gi'), label);
}

export function gateRow(m: string, g: MachineGate | null): string {
    if (!g) return `${m.padEnd(5)} not gated`;
    const minute = g.startedUtc.slice(11, 16);
    const a = g.a ? `${g.a.onTime}/${g.a.trials}` : '-';
    const b = g.b ? `${g.b.p90} ms` : '-';
    const c = g.c ? `${g.c.perMinute}/min` : '-';
    const d = g.d ? `${g.d.lowest} / ${g.d.median} / ${g.d.highest}` : '-';
    return `${m.padEnd(5)} ${minute}Z  (a) ${a.padEnd(6)} (b) p90 ${b.padEnd(7)} (c) ${c.padEnd(9)} (d) p10 ${d.padEnd(20)} ${g.status.padEnd(10)} online ${g.players ?? '?'}  gate logout ${g.gateLogout}${g.failures.length ? `  [${g.failures.join('; ')}]` : ''}`;
}

/** Single-quote for a POSIX shell. */
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

const ACCOUNT = /^[a-z0-9_]{1,12}$/i;

export function checkAccount(name: string, what: string): string {
    if (!ACCOUNT.test(name)) throw new Stop(`${what} is not an account name (letters, digits, underscore, at most 12)`);
    return name;
}

/** The ssh argv for a machine, RUN-HOST.md "Reaching them"; the address only from the local env. */
export function sshArgv(m: Machine, env: Record<string, string | undefined>, home = HOME): string[] {
    const v = m === 'run' ? 'RS_RUN_HOST' : 'RS_TWIN_HOST';
    const host = env[v];
    if (!host) throw new Stop(`set ${v} in your shell from cairn://p/rs/host (never commit it)`);
    const [key, known] = m === 'run' ? ['id_ed25519_ashburn', 'known_hosts_ashburn'] : ['id_ed25519_rehearsal', 'known_hosts_rehearsal'];
    return [
        'ssh', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-i', `${home}/.rs-fleet/${key}`,
        '-o', `UserKnownHostsFile=${home}/.rs-fleet/${known}`, '-o', 'StrictHostKeyChecking=yes', '-o', 'CheckHostIP=no',
        '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', `ubuntu@${host}`,
    ];
}

/**
 * The remote shell line: the on-machine command detached under its own bound, writing
 * ~/rs-run/gate-<stamp>/steps.log, which the ssh session follows until the command exits and
 * then exits with its code. A dropped ssh line ends the `tail`, never the command.
 */
export function remoteLine(checkout: string, stamp: string, bound: string, args: readonly string[]): string {
    if (!/^[\w./-]+$/.test(checkout) || checkout.startsWith('/') || checkout.includes('..')) throw new Stop(`--remote-checkout must be a plain path under the machine's $HOME, not ${checkout}`);
    const cmd = ['timeout', '--kill-after=30s', bound, '"$HOME"/.bun/bin/bun', 'speedrun/tools/run-gate.ts', 'on-machine', ...args.map(shq), '--out="$D"'].join(' ');
    return `cd "$HOME"/${checkout} && D="$HOME"/rs-run/gate-${stamp} && mkdir -p "$D" && { nohup ${cmd} >>"$D"/steps.log 2>&1 </dev/null & P=$!; tail --pid=$P -n +1 -f "$D"/steps.log; wait $P; }`;
}

// ------------------------------------------------------------------ process helpers

const flags = (argv: readonly string[]) => {
    const get = (k: string) => argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
    const has = (k: string) => argv.includes(`--${k}`);
    return { get, has };
};

const utc = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const stampOf = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

async function capture(argv: string[], env: Record<string, string | undefined> = process.env, cwd = ROOT): Promise<{ code: number; out: string; err: string }> {
    const p = Bun.spawn(argv, { env, cwd, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { code, out, err };
}

const bash = (line: string, env?: Record<string, string | undefined>) => capture(['bash', '-c', line], env);

/** Run argv, printing each output line through `map` (null drops it); resolves the exit code. */
async function stream(argv: string[], map: (line: string) => string | null, opts: { env?: Record<string, string | undefined>; cwd?: string } = {}): Promise<number> {
    const p = Bun.spawn(argv, { env: opts.env ?? process.env, cwd: opts.cwd ?? ROOT, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
    const pump = async (s: ReadableStream<Uint8Array>) => {
        const dec = new TextDecoder();
        let buf = '';
        const reader = s.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let i: number;
            while ((i = buf.indexOf('\n')) >= 0) {
                const out = map(buf.slice(0, i));
                if (out !== null) console.log(out);
                buf = buf.slice(i + 1);
            }
        }
        if (buf) {
            const out = map(buf);
            if (out !== null) console.log(out);
        }
    };
    await Promise.all([pump(p.stdout), pump(p.stderr)]);
    return p.exited;
}

// ------------------------------------------------------------------ on the machine

interface Ctx {
    display: string;
    out: string;
    rehearsal: boolean;
    claim: string | null;
    bound: string;
    progress: string;
    /** Every printed line goes through this (SCORED's relabelling). */
    say: (s: string) => string;
}

function step(ctx: Ctx, name: string, detail: string) {
    console.log(ctx.say(`[step] ${utc()} ${name}: ${detail}`));
}

const bun = process.execPath;

async function tmuxHas(session: string): Promise<boolean> {
    return (await capture(['tmux', '-L', 'run', 'has-session', '-t', session])).code === 0;
}

/**
 * `pgrep -f rs-run/chrome-profile`, less a tmux server: tmux names its server process after the
 * command of the first session it was started with, so a server first started for `chrome` keeps
 * the profile in its command line after Chrome is gone.
 */
async function profilePids(): Promise<number[]> {
    const r = await capture(['pgrep', '-f', 'rs-run/chrome-profile']);
    const pids = r.out.split('\n').map(Number).filter(n => n > 0 && n !== process.pid);
    return pids.filter(p => {
        try {
            return !readFileSync(`/proc/${p}/comm`, 'utf8').startsWith('tmux');
        } catch {
            return false; // exited meanwhile
        }
    });
}

async function windowsOn(display: string): Promise<XwinWindow[]> {
    const r = await capture(['xwininfo', '-root', '-tree'], { ...process.env, DISPLAY: display });
    if (r.code !== 0) throw new Stop(`xwininfo on ${display} failed: ${r.err.trim()}`);
    return botClientWindows(r.out);
}

/** Ruling 2 (and ruling 5's guard): no gate or run Chrome, no Bot Client window. Null when it holds. */
async function noChromeProblem(display: string): Promise<string | null> {
    const problems: string[] = [];
    if (await tmuxHas('chrome')) problems.push('`tmux -L run` still has a session `chrome`');
    const pids = await profilePids();
    if (pids.length) problems.push(`${pids.length} process(es) still on rs-run/chrome-profile (pids ${pids.slice(0, 6).join(' ')})`);
    const ws = await windowsOn(display);
    if (ws.length) problems.push(`${ws.length} Bot Client window(s) on ${display}`);
    return problems.length ? problems.join('; ') : null;
}

async function claimCheck(ctx: Ctx): Promise<ClaimStatus> {
    const tool = join(HOME, '.local/bin/rs-claim');
    if (!existsSync(tool)) throw new Stop(`no ${tool}: the claim lock (tenet 21) is not installed here`);
    const r = await capture([tool, 'status']);
    const c = parseClaimStatus(r.out);
    if (c.free || !c.live) throw new Stop(`no live claim on this machine (rs-claim: ${r.out.split('\n')[0]}); take one first (tenet 21; the run's is host's preempt)`);
    if (c.preempted) throw new Stop(`the claim is preempted (${r.out.trim().replace(/\n\s*/g, '; ')})`);
    if (ctx.claim && c.owner !== ctx.claim) throw new Stop(`the live claim is ${c.owner}'s, not ${ctx.claim}'s`);
    if (ctx.rehearsal && (!ctx.claim || c.owner === 'host' || c.owner === 'run')) throw new Stop('a rehearsal runs under its own claim: pass --claim=OWNER (not host or run)');
    if (ctx.claim) await capture([tool, 'touch', ctx.claim]);
    return c;
}

async function displayCheck(ctx: Ctx) {
    const r = await capture(['xdpyinfo'], { ...process.env, DISPLAY: ctx.display });
    const dim = r.out.match(/dimensions:\s+(\d+)x(\d+) pixels/);
    const depth = r.out.match(/depth of root window:\s+(\d+) planes/);
    if (r.code !== 0 || !dim || !depth) throw new Stop(`display ${ctx.display} does not answer (xdpyinfo exit ${r.code}): is the operator's desktop session up (RUN-HOST.md step 2)?`);
    if (dim[1] !== '1920' || dim[2] !== '1080' || depth[1] !== '24') throw new Stop(`display ${ctx.display} is ${dim[1]}x${dim[2]} at ${depth[1]} planes, not 1920x1080 at 24 (RUN-HOST.md step 2)`);
    const rdp = await bash(`ss -Htn state established '( sport = :3389 )' | wc -l`);
    const n = Number(rdp.out.trim());
    if (n !== 0) throw new Stop(`${n} remote desktop connection(s) are up: the operator disconnects before the recording and the gate (tenet 12)`);
    step(ctx, 'display', `${ctx.display} 1920x1080 at 24 planes, remote desktop disconnected`);
}

const lastFrame = (text: string) => {
    const all = [...text.matchAll(/^frame=(\d+)$/gm)];
    return all.length ? Number(all[all.length - 1]![1]) : null;
};

/** Ruling 4's first half: a recording grabs the display, and its frame counter advances. */
async function recordingCheck(ctx: Ctx) {
    const { recordingState } = await import('../lib/display');
    const r = await recordingState(ctx.display);
    if (r.on !== true) throw new Stop(`no recording grabs ${ctx.display}${r.why ? ` (${r.why})` : ''}: it starts before the gate and before SCORED's login (\`up\`, RUN-HOST.md step 5)`);
    const read = () => (existsSync(ctx.progress) ? readFileSync(ctx.progress, 'utf8') : '');
    const f0 = lastFrame(read());
    await Bun.sleep(2_500);
    const text = read();
    const f1 = lastFrame(text);
    if (f0 === null || f1 === null || f1 <= f0) throw new Stop(`the recording's frame counter is not advancing in ${ctx.progress} (${f0} then ${f1})`);
    const last = (k: string) => [...text.matchAll(new RegExp(`^${k}=(\\S+)$`, 'gm'))].at(-1)?.[1] ?? '?';
    step(ctx, 'recording', `pid ${r.pid} writing ${r.file ?? '(file not named)'}; frame ${f1}, fps ${last('fps')}, dropped ${last('drop_frames')}`);
}

async function envFile(path: string, what: string): Promise<{ name: string; path: string; password: string }> {
    if (!existsSync(path)) throw new Stop(`no env file for ${what} at the given path`);
    const mode = statSync(path).mode & 0o777;
    if (mode !== 0o600) throw new Stop(`${what}'s env file is mode ${mode.toString(8)}, not 600 (chmod 600)`);
    const text = readFileSync(path, 'utf8');
    const name = text.match(/^BOT_USERNAME=(.*)$/m)?.[1]?.trim() ?? '';
    const password = text.match(/^PASSWORD=(.*)$/m)?.[1] ?? '';
    checkAccount(name, `${what}'s BOT_USERNAME`);
    const expect = join(ROOT, 'bots', name, 'bot.env');
    if (resolve(path) !== expect) throw new Stop(`${what}'s env file must be <checkout>/bots/<BOT_USERNAME>/bot.env (RUN-HOST.md step 0)`);
    if (!password) throw new Stop(`${what}'s env file has no PASSWORD`);
    return { name, path, password };
}

async function chromeFlagsCheck(ctx: Ctx) {
    const r = await capture(['ps', '-o', 'args=', '-C', 'chrome']);
    const browser = r.out.split('\n').find(l => l.includes(`--user-data-dir=${PROFILE}`) && !l.includes('--type='));
    if (!browser) throw new Stop('no Chrome browser process on rs-run/chrome-profile');
    const missing = CHROME_FLAGS.filter(f => !browser.includes(`--${f}`));
    if (missing.length) throw new Stop(`Chrome runs without ${missing.join(', ')} (RUN-HOST.md step 3)`);
    step(ctx, 'chrome flags', `all six present (${CHROME_FLAGS.map(f => f.split('=')[0]).join(', ')})`);
}

/** Start step 3's Chrome on the account's bare page, and wait for its tab and its window. */
async function launchTab(ctx: Ctx, name: string, bound: string) {
    checkAccount(name, 'the account');
    const line =
        `exec timeout --kill-after=30s ${bound} env DISPLAY=${ctx.display} google-chrome --user-data-dir=${PROFILE} --remote-debugging-port=9222 ` +
        `--no-first-run --no-default-browser-check --password-store=basic --disable-background-timer-throttling --disable-renderer-backgrounding ` +
        `--disable-backgrounding-occluded-windows --start-maximized --app="${PAGE}/bot?bot=${name}"`;
    const r = await capture(['tmux', '-L', 'run', 'new-session', '-d', '-s', 'chrome', line]);
    if (r.code !== 0) throw new Stop(`tmux could not start Chrome: ${r.err.trim()}`);
    const { botTabs } = await import('../lib/tab');
    const until = Date.now() + 30_000;
    let tab = false;
    let ws: XwinWindow[] = [];
    // Waiting for Chrome to map and maximise its one window; nothing on the display is touched.
    while (Date.now() < until) {
        try {
            tab = botTabs((await (await fetch(`${CDP}/json/list`)).json()) as never, name).length > 0;
        } catch {
            tab = false;
        }
        ws = await windowsOn(ctx.display);
        if (tab && ws.length === 1 && ws[0]!.width === RECORD_WIDTH) break;
        await Bun.sleep(500);
    }
    if (!tab) throw new Stop(`Chrome's DevTools port lists no tab for the account within 30 s`);
    step(ctx, 'tab', `Chrome up on the bare page (bound ${bound}); ${ws.length} Bot Client window(s): ${ws.map(w => `${w.width}x${w.height}`).join(', ') || 'none'}`);
}

/** tab-login.ts, bound 3 min; its lines go through ctx.say. */
async function tabLogin(ctx: Ctx, name: string): Promise<void> {
    const code = await stream(['timeout', '--kill-after=30s', '3m', bun, 'speedrun/tools/tab-login.ts', name, `--bots-dir=${join(ROOT, 'bots')}`], l => ctx.say(`  ${l}`));
    if (code !== 0) throw new Stop(`tab-login exited ${code}: the tab is not in game`, 2);
    step(ctx, 'login', 'the tab is in game');
}

/** RUN-HOST.md step 3's secrets check, in process: no password or token in ps, none in a tab URL. */
async function secretsCheck(ctx: Ctx, password: string) {
    const ps = (await capture(['ps', '-efww'])).out.split('\n');
    const withPassword = ps.filter(l => l.includes(password)).length;
    const withToken = ps.filter(l => /token=/.test(l)).length;
    let inUrls = 0;
    try {
        const list = (await (await fetch(`${CDP}/json/list`)).json()) as Array<{ url: string }>;
        inUrls = list.filter(t => t.url.includes('token=') || t.url.includes(password)).length;
    } catch {
        throw new Stop("Chrome's DevTools port does not answer for the secrets check");
    }
    if (withPassword || withToken || inUrls) throw new Stop(`secrets check ${withPassword} ${withToken} ${inUrls}, not 0 0 0: a password or token is visible (RUN-HOST.md step 3)`);
    step(ctx, 'secrets', '0 0 0');
}

/**
 * Ruling 4's pass line: the window in front of the display is the run tab, and an x11grab frame
 * of the display matches the page's own screenshot. It waits up to `waitMs` for a conclusive
 * match (a page still loading is flat and inconclusive) and never raises or touches a window.
 */
async function liveFrame(ctx: Ctx, name: string, tag: string, waitMs = 20_000): Promise<void> {
    const { frameShows, frontWindows, grabFrame, xpropRunner } = await import('../lib/display');
    const { screenshotTab } = await import('../lib/tab');
    const until = Date.now() + waitMs;
    let n = 0;
    let last = 'no look taken';
    while (Date.now() < until || n === 0) {
        n++;
        const front = await frontWindows(xpropRunner(ctx.display));
        const top = front.top?.name ?? 'none';
        const framePath = join(ctx.out, `${tag}-frame-${n}.png`);
        const pagePath = join(ctx.out, `${tag}-page-${n}.png`);
        await grabFrame(ctx.display, framePath);
        const page = await screenshotTab(CDP, name);
        if (!page) throw new Stop(`the run tab has no page to screenshot (${tag})`);
        writeFileSync(pagePath, page);
        const f = await frameShows(framePath, pagePath);
        const topOk = /Bot Client/.test(top);
        last = `front window "${ctx.say(top)}", frame difference ${f.diff ?? '-'} (pass at <= ${f.max}), page contrast ${f.contrast}, at ${f.at ? `${f.at.x},${f.at.y}` : '-'}`;
        if (topOk && f.match === true) {
            console.log(ctx.say(`[gate] ${utc()} live frame (${tag}): PASS: ${last}; ${framePath}`));
            return;
        }
        await Bun.sleep(1_000);
    }
    throw new Stop(`live frame (${tag}) FAIL after ${n} look(s): ${last}: the recording does not show the run tab`, 1);
}

async function onUp(ctx: Ctx, argv: readonly string[]) {
    const f = flags(argv);
    const bind = f.get('live-bind');
    if (!bind || !/^\d{1,3}(\.\d{1,3}){3}$/.test(bind)) throw new Stop('--live-bind=IPv4 is required: the run host binds its tailnet address, the twin 127.0.0.1 (RUN-HOST.md step 5)');
    await claimCheck(ctx);
    await displayCheck(ctx);
    const up: string[] = [];
    for (const s of ['gateway', 'page', 'rec', 'live', 'chrome']) if (await tmuxHas(s)) up.push(s);
    if (up.length) throw new Stop(`the run stack is already up (tmux -L run: ${up.join(', ')}); tear it down first (RUN-HOST.md step 9)`);
    const ports = await bash(`ss -Hltn | grep -E ':(7780|8899|8090) ' || true`);
    if (ports.out.trim()) throw new Stop(`a port the stack needs is taken: ${ports.out.trim().replace(/\s+/g, ' ')}`);
    if (!existsSync(join(ROOT, 'server/webclient/out/bot/client.js'))) throw new Stop("the checkout has no built client (server/webclient/out/bot/client.js): RUN-HOST.md step 0's build");
    const T = ctx.bound;
    const start = async (name: string, cwd: string | null, line: string) => {
        const r = await capture(['tmux', '-L', 'run', 'new-session', '-d', '-s', name, ...(cwd ? ['-c', cwd] : []), line]);
        if (r.code !== 0) throw new Stop(`tmux could not start ${name}: ${r.err.trim()}`);
    };
    await start('gateway', join(ROOT, 'server/gateway'), `exec timeout --kill-after=30s ${T} env AGENT_PORT=7780 GATEWAY_HOSTNAME=127.0.0.1 ${bun} run gateway.ts >>${HOME}/rs-run/gateway.log 2>&1`);
    await start('page', join(ROOT, 'server/webclient'), `exec timeout --kill-after=30s ${T} ${bun} run proxy.ts --world=https://${DEMO} --port=8899 --gateway=ws://127.0.0.1:7780 >>${HOME}/rs-run/page.log 2>&1`);
    await Bun.sleep(4_000);
    const listening = (await bash(`ss -Hltn | grep -cE ':(7780|8899) '`)).out.trim();
    if (listening !== '2') throw new Stop(`the gateway (7780) and page server (8899) are not both listening (${listening} of 2); see ~/rs-run/gateway.log and page.log`);
    const redirect = (await bash(`curl -s -o /dev/null -w '%{http_code} %{redirect_url}' '${PAGE}/bot?bot=x'`)).out.trim();
    if (!redirect.startsWith('302 ') || !redirect.includes(`server=${DEMO}`)) throw new Stop(`the page server answers ${redirect}, not a 302 to the demo (RUN-HOST.md step 3)`);
    const refuse = (await bash(`curl -s -o /dev/null -w '%{http_code}' '${PAGE}/bot?bot=x&password=y'`)).out.trim();
    if (refuse !== '400') throw new Stop(`the page server answers ${refuse} to a password in the URL, not 400 (rs/138 must be on the checkout)`);
    step(ctx, 'stack', `gateway 7780 and page server 8899 up (bound ${T}); ${redirect}; password URL refused 400`);
    mkdirSync(join(HOME, 'recordings'), { recursive: true });
    const file = join(HOME, 'recordings', `${ctx.rehearsal ? 'rehearsal' : 'run'}-${stampOf()}.mkv`);
    await bash(`rm -f ${shq(ctx.progress)}`);
    await start(
        'rec',
        null,
        `exec timeout -s INT --kill-after=30s ${T} ffmpeg -hide_banner -loglevel warning -f x11grab -draw_mouse 1 -framerate 30 -video_size 1920x1080 -i ${ctx.display}.0+0,0 -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -progress ${ctx.progress} ${file} 2>>${HOME}/recordings/ffmpeg.log`
    );
    await start(
        'live',
        null,
        `exec timeout --kill-after=30s ${T} bash -c "while true; do ffmpeg -nostdin -hide_banner -loglevel warning -f x11grab -draw_mouse 1 -framerate 3 -video_size 1920x1080 -i ${ctx.display}.0+0,0 -vf scale=960:540 -c:v mjpeg -q:v 8 -f mpjpeg -listen 1 http://${bind}:8090/live.mjpg; sleep 1; done"`
    );
    await Bun.sleep(5_000);
    await recordingCheck(ctx);
    step(ctx, 'live view', `3 fps MJPEG on port 8090 of the given bind address (bound ${T})`);
    console.log(`UP-RESULT ${JSON.stringify({ ok: true, recording: file, utc: utc() })}`);
}

async function onGate(ctx: Ctx, argv: readonly string[]): Promise<number> {
    const f = flags(argv);
    const gate = checkAccount(f.get('gate') ?? '', '--gate');
    const minutes = Number(f.get('minutes') ?? '5');
    const rehearse = f.get('rehearse') ?? null;
    if (rehearse && !['unconfirmed-logout', 'kept-chrome'].includes(rehearse)) throw new Stop(`--rehearse is unconfirmed-logout or kept-chrome, not ${rehearse}`);
    if (rehearse && !ctx.rehearsal) throw new Stop('--rehearse needs --rehearsal');
    const g: MachineGate = { machine: (await capture(['hostname'])).out.trim(), startedUtc: utc(), endUtc: '', status: 'not-probed', a: null, b: null, c: null, d: null, players: null, gateLogout: 'not-run', failures: [] };
    const finish = (code: number) => {
        g.endUtc = utc();
        writeFileSync(join(ctx.out, 'verdict.json'), JSON.stringify(g, null, 2));
        console.log(`GATE-RESULT ${JSON.stringify(g)}`);
        return code;
    };
    try {
        // Preconditions, including ruling 5's guard: no run or gate tab may already be on this display.
        await claimCheck(ctx);
        await displayCheck(ctx);
        const busy = await noChromeProblem(ctx.display);
        if (busy) throw new Stop(`a tab is already on the recorded display (${busy}): never gate where a run tab may be; probes go to the machine not chosen`);
        for (const s of ['gateway', 'page', 'rec', 'live']) if (!(await tmuxHas(s))) throw new Stop(`\`tmux -L run\` has no ${s} session: run \`up\` first`);
        const timer = (await capture(['systemctl', '--user', 'is-active', 'rs-gate-read.service'])).out.trim();
        if (timer === 'active') throw new Stop('a gate history timer read is in progress (rs-gate-read.service active): wait for it to finish');
        await recordingCheck(ctx);
        const env = await envFile(join(ROOT, 'bots', gate, 'bot.env'), 'the gate account');
        step(ctx, 'preconditions', `claim live, stack up, no tab on ${ctx.display}, gate timer ${timer}, gate account ${gate}`);

        // (a)-(c): rs/96's direct CLI, before the gate tab opens (it logs the account in itself).
        const json = join(ctx.out, 'direct.json');
        step(ctx, '(a)-(c)', `tickmanip-latency.ts ${gate} --path=direct --no-tele (bound 15m)`);
        const dcode = await stream(['timeout', '--kill-after=30s', '15m', bun, 'docs/speedrun/scripts/tickmanip-latency.ts', gate, '--path=direct', '--no-tele', `--json=${json}`], l => `  ${l}`);
        if (dcode === 2) throw new Stop('(a)-(c) not probed: a vantage precondition failed (edge iad, TCP connect p50 <= 5 ms); see the vantage line');
        if (!existsSync(json)) throw new Stop(`(a)-(c): the direct CLI exited ${dcode} without a result`);
        const direct = parseDirectJson(readFileSync(json, 'utf8'));
        g.players = direct.players;
        const pre = machineVerdict(direct, null, { requireLoops: false });
        g.a = { onTime: direct.onTime, trials: direct.trials, passAt: pre.verdict.passAt, floorAt: pre.verdict.floorAt };
        g.b = direct.steadiness ? { p90: direct.steadiness.p90 } : null;
        g.c = direct.steadiness ? { perMinute: direct.steadiness.catchUpsPerMinute } : null;
        if (direct.logoutOk === false) step(ctx, '(a)-(c)', 'WARNING: the direct probe did not confirm its logout; the tab login may meet "already logged in"');
        if (!startable(pre.status)) {
            g.status = pre.status;
            g.failures = pre.failures;
            console.log(`STOP: (a)-(c) ${pre.status}: ${pre.failures.join('; ')}; (d) not measured`);
            return finish(pre.status === 're-measure' ? 3 : 1);
        }

        // (d): the gate tab, logged in, sampled; then logged out and, whatever the logout said, killed.
        let loops: LoopsSummary | null = null;
        let sampleError: string | null = null;
        try {
            await launchTab(ctx, gate, GATE_TAB_BOUND);
            await chromeFlagsCheck(ctx);
            await tabLogin(ctx, gate);
            await secretsCheck(ctx, env.password);
            const jsonl = join(ctx.out, 'loops.jsonl');
            step(ctx, '(d)', `runhost-loops.ts ${gate} --minutes=${minutes} (bound 10m)`);
            const lcode = await stream(
                ['timeout', '--kill-after=30s', '10m', bun, 'docs/speedrun/scripts/runhost-loops.ts', gate, '--label=gate', `--minutes=${minutes}`, `--display=${ctx.display}`, `--out=${jsonl}`, `--progress=${ctx.progress}`],
                l => (/^\[(Runner|BotSDK)\]|Pathfinding|LOGOUT DEBUG/.test(l) ? null : `  ${l}`)
            );
            const samples = existsSync(jsonl) ? readFileSync(jsonl, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as { loopsP10?: unknown }) : [];
            loops = loopsSummary(samples);
            if (lcode !== 0) sampleError = `the (d) sampler exited ${lcode}`;
        } catch (e) {
            sampleError = e instanceof Error ? e.message : String(e);
        } finally {
            if (rehearse) {
                g.gateLogout = 'unconfirmed';
                step(ctx, 'gate logout', `NOT CONFIRMED (forced by --rehearse=${rehearse}: logoutClean skipped)`);
            } else {
                const snippet =
                    'const m = await import("./speedrun/lib/session.ts"); const s = await m.openSession(process.env.B, { client: "browser", pathfinding: false, readyTimeoutMs: 30000 }); ' +
                    'const r = await m.logoutClean(s); console.log(r.ok ? "logged out; the page is out of game" : "not confirmed: " + r.reason); await m.closeSession(s); process.exit(r.ok ? 0 : 1);';
                const lo = await stream(['timeout', '--kill-after=30s', '3m', bun, '-e', snippet], l => (/^\[(Runner|BotSDK)\]|LOGOUT DEBUG/.test(l) ? null : `  ${l}`), { env: { ...process.env, B: gate } });
                g.gateLogout = lo === 0 ? 'confirmed' : 'unconfirmed';
                step(ctx, 'gate logout', lo === 0 ? 'confirmed by the page' : `NOT CONFIRMED (exit ${lo}); the window is killed anyway`);
            }
            // Ruling 1: the gate Chrome is killed whatever the logout said.
            if (rehearse === 'kept-chrome') step(ctx, 'gate chrome', 'NOT killed (forced by --rehearse=kept-chrome: the old `logout && kill`)');
            else await killGateChrome(ctx);
        }
        // Ruling 2, after the kill.
        const left = await noChromeProblem(ctx.display);
        if (left) throw new Stop(`the gate tab is not closed after the kill: ${left}`);
        step(ctx, 'closed', `no tmux chrome session, no rs-run/chrome-profile process, no Bot Client window on ${ctx.display}`);
        if (sampleError) throw new Stop(`(d) not measured: ${sampleError}`);

        const v = machineVerdict(direct, loops);
        g.d = loops;
        g.status = v.status;
        g.failures = v.failures;
        console.log(`[gate] ${verdictText(v.verdict)}`);
        console.log(`[gate] ${gateRow(g.machine, g)}`);
        return finish(startable(v.status) ? 0 : v.status === 're-measure' ? 3 : 1);
    } catch (e) {
        if (!(e instanceof Stop)) throw e;
        g.failures.push(e.message);
        if (g.status === 'pass' || g.status === 'marginal') g.status = 'fail';
        console.log(`STOP: ${e.message}`);
        return finish(e.code);
    }
}

/** Ruling 1: end the gate Chrome by its tmux session, then by its profile, then SIGKILL. */
async function killGateChrome(ctx: Ctx) {
    await capture(['tmux', '-L', 'run', 'kill-session', '-t', 'chrome']);
    const gone = async (ms: number) => {
        const until = Date.now() + ms;
        while (Date.now() < until) {
            if (!(await profilePids()).length) return true;
            await Bun.sleep(250);
        }
        return !(await profilePids()).length;
    };
    let how = 'tmux kill-session';
    if (!(await gone(10_000))) {
        how += ', then SIGTERM on the profile';
        await capture(['pkill', '-TERM', '-f', 'rs-run/chrome-profile']);
        if (!(await gone(5_000))) {
            how += ', then SIGKILL';
            await capture(['pkill', '-KILL', '-f', 'rs-run/chrome-profile']);
            await gone(5_000);
        }
    }
    step(ctx, 'gate chrome', `killed unconditionally (${how})`);
}

async function onHandoff(ctx: Ctx, argv: readonly string[]): Promise<number> {
    const f = flags(argv);
    const envPath = f.get('scored-env');
    if (!envPath) throw new Stop('--scored-env=PATH is required');
    const cap = Number(f.get('cap') ?? '80');
    let name: string | null = null;
    const result = { ok: false, utc: '', reason: '' };
    try {
        const env = await envFile(resolve(envPath), 'SCORED');
        name = env.name;
        const label = 'SCORED';
        const plain = ctx.say;
        ctx.say = s => relabel(plain(s), name, label);

        await claimCheck(ctx);
        // Ruling 2: after the gate's unconditional kill, nothing of the gate Chrome is left.
        const left = await noChromeProblem(ctx.display);
        if (left) throw new Stop(`step-7 precondition failed: ${left}`);
        step(ctx, 'preconditions', `no tmux chrome session, no rs-run/chrome-profile process, no Bot Client window on ${ctx.display}`);
        await displayCheck(ctx);
        // Ruling 4's first half: the recording is already running before the login.
        await recordingCheck(ctx);
        const claim = await claimCheck(ctx);
        if (claim.ours === null) throw new Stop('the login count is unavailable (rs-claim could not read /playerpositions): do not log SCORED in uncounted (tenet 16)');
        if (claim.ours + 1 > cap) throw new Stop(`login count ${claim.ours} of ours online + SCORED's 1 is over ${cap} (tenet 16; log the unneeded fleet out first)`);
        step(ctx, 'login count', `${claim.ours} of ours online + 1 = ${claim.ours + 1}, at most ${cap}`);

        // From here a failure leaves SCORED's bare page up, not logged in, for the operator to read.
        await launchTab(ctx, env.name, ctx.bound);
        await chromeFlagsCheck(ctx);
        // Ruling 3: exactly one Bot Client window, 1920 wide, before the login.
        const one = oneWindowProblem(await windowsOn(ctx.display));
        if (one) throw new Stop(`window check before the login: ${one}`, 1);
        step(ctx, 'one window', `exactly one Bot Client window on ${ctx.display}, ${RECORD_WIDTH} wide`);
        // Rulings 4 and 5: the recording's live frame shows the run tab, in front, before the login.
        await liveFrame(ctx, env.name, 'scored-title');

        await tabLogin(ctx, env.name);
        await secretsCheck(ctx, env.password);
        await Bun.sleep(2_000);
        const after = oneWindowProblem(await windowsOn(ctx.display));
        if (after) throw new Stop(`window check after the login: ${after}; SCORED is in game: touch nothing on the display and tell main`, 1);
        await liveFrame(ctx, env.name, 'scored-ingame');
        result.ok = true;
        result.reason = 'SCORED is in game, alone and in front on the recorded display, with the recording showing it';
        console.log(ctx.say(`[handoff] ${utc()} PASS: ${result.reason}. The run scripts take it from here; nothing else opens a window on ${ctx.display} until the run ends.`));
        return 0;
    } catch (e) {
        if (!(e instanceof Stop)) throw e;
        result.reason = e.message;
        console.log(ctx.say(`STOP: ${e.message}`));
        return e.code;
    } finally {
        result.utc = utc();
        const line = relabel(JSON.stringify(result), name, 'SCORED');
        writeFileSync(join(ctx.out, 'handoff.json'), line);
        console.log(`HANDOFF-RESULT ${line}`);
    }
}

async function onMachine(argv: readonly string[]): Promise<number> {
    const [cmd, ...rest] = argv;
    const f = flags(rest);
    const rehearsal = f.has('rehearsal');
    const out = f.get('out') ?? join(HOME, 'rs-run', `gate-${stampOf()}`);
    mkdirSync(out, { recursive: true });
    const ctx: Ctx = {
        display: f.get('display') ?? ':10',
        out,
        rehearsal,
        claim: f.get('claim') ?? null,
        bound: rehearsal ? REHEARSAL_BOUND : RUN_BOUND,
        progress: f.get('progress') ?? join(HOME, 'recordings/ffmpeg-progress.log'),
        say: s => s,
    };
    try {
        if (!/^:\d+$/.test(ctx.display)) throw new Stop(`--display must look like :10, not ${ctx.display}`);
        console.log(`[run-gate] ${utc()} on-machine ${cmd} on ${(await capture(['hostname'])).out.trim()}, checkout ${ROOT} at ${(await capture(['git', 'log', '-1', '--format=%h'])).out.trim()}, ${rehearsal ? 'REHEARSAL' : 'RUN'}, outputs ${out}`);
        if (cmd === 'up') {
            await onUp(ctx, rest);
            return 0;
        }
        if (cmd === 'gate') return await onGate(ctx, rest);
        if (cmd === 'handoff') return await onHandoff(ctx, rest);
        throw new Stop(`on-machine takes up, gate or handoff, not ${cmd}`);
    } catch (e) {
        if (!(e instanceof Stop)) throw e;
        console.log(`STOP: ${e.message}`);
        return e.code;
    }
}

// ------------------------------------------------------------------ on the Mac

interface RemoteRun {
    machine: Machine;
    code: number;
    lines: string[];
}

async function remote(m: Machine, args: readonly string[], opts: { checkout: string; stamp: string; bound: string; log: string }): Promise<RemoteRun> {
    const lines: string[] = [];
    const argv = [...sshArgv(m, process.env), remoteLine(opts.checkout, opts.stamp, opts.bound, args)];
    const code = await stream(argv, l => {
        lines.push(l);
        const out = `[${m}] ${l}`;
        appendFileSync(opts.log, out + '\n');
        return out;
    }, { cwd: process.cwd() });
    return { machine: m, code, lines };
}

const resultOf = <T>(r: RemoteRun, tag: string): T | null => {
    const line = [...r.lines].reverse().find(l => l.startsWith(`${tag} `));
    return line ? (JSON.parse(line.slice(tag.length + 1)) as T) : null;
};

function pickMachines(v: string | undefined): Machine[] {
    const ms = (v ?? 'run,twin').split(',').map(s => s.trim()).filter(Boolean);
    for (const m of ms) if (!MACHINES.includes(m as Machine)) throw new Stop(`--machines takes run and/or twin, not ${m}`);
    return [...new Set(ms)] as Machine[];
}

async function mac(argv: readonly string[]): Promise<number> {
    const [cmd, ...rest] = argv;
    const f = flags(rest);
    const rehearsal = f.has('rehearsal');
    const logDir = f.get('log-dir') ?? join(HOME, 'rs-run-gate');
    mkdirSync(logDir, { recursive: true });
    const stamp = stampOf();
    const log = join(logDir, `${cmd}-${stamp}.log`);
    const checkout = f.get('remote-checkout') ?? 'rs-sdk';
    const pass = ['display', 'claim'].flatMap(k => (f.get(k) ? [`--${k}=${f.get(k)}`] : [])).concat(rehearsal ? ['--rehearsal'] : []);
    const say = (s: string) => {
        console.log(s);
        appendFileSync(log, s + '\n');
    };
    say(`[run-gate] ${utc()} ${cmd}${rehearsal ? ' (REHEARSAL)' : ''}; log ${log}`);

    if (cmd === 'up') {
        const ms = pickMachines(f.get('machines'));
        const bind = (m: Machine) => {
            if (m === 'twin') return '127.0.0.1';
            const t = process.env.RS_RUN_TAILNET;
            if (!t) throw new Stop('set RS_RUN_TAILNET in your shell from cairn://p/rs/host: the run host binds its live view there');
            return t;
        };
        const runs = await Promise.all(ms.map(m => remote(m, ['up', `--live-bind=${bind(m)}`, ...pass], { checkout, stamp, bound: '3m', log })));
        for (const r of runs) say(`[run-gate] ${r.machine}: ${r.code === 0 ? 'up' : `NOT up (exit ${r.code})`}`);
        return Math.max(0, ...runs.map(r => r.code));
    }

    if (cmd === 'gate') {
        const ms = pickMachines(f.get('machines'));
        const accounts: Record<Machine, string | undefined> = { run: f.get('gate-run'), twin: f.get('gate-twin') };
        for (const m of ms) checkAccount(accounts[m] ?? '', `--gate-${m}`);
        if (ms.length === 2 && accounts.run === accounts.twin) throw new Stop('each machine gates on its own account: one account is in the world only once (RUN-HOST.md step 0)');
        const extra = ['minutes', 'rehearse'].flatMap(k => (f.get(k) ? [`--${k}=${f.get(k)}`] : []));
        if (ms.length < 2) say(`[run-gate] WARNING: gating ${ms.join('')} only; a run-day choice gates both machines in the same minute (tenet 17)`);
        const runs = await Promise.all(ms.map(m => remote(m, ['gate', `--gate=${accounts[m]}`, ...extra, ...pass], { checkout, stamp, bound: '40m', log })));
        const gates: Partial<Record<Machine, MachineGate | null>> = {};
        for (const r of runs) gates[r.machine] = resultOf<MachineGate>(r, 'GATE-RESULT');
        say('');
        say('[run-gate] the gate, per machine (RUN-HOST.md step 5a.3: record both):');
        for (const m of MACHINES) if (ms.includes(m)) say(`  ${gateRow(m, gates[m] ?? null)}`);
        const choice = choose(gates);
        say(`[run-gate] chosen: ${choice.machine ?? 'NONE'}: ${choice.reason}`);
        const record = { utc: utc(), stamp, machines: ms, rehearsal, gates, choice };
        writeFileSync(join(logDir, `choice-${stamp}.json`), JSON.stringify(record, null, 2));
        writeFileSync(join(logDir, 'choice.json'), JSON.stringify(record, null, 2));
        if (choice.machine) say(`[run-gate] next: the roster on ${choice.machine} (RUN-HOST.md step 5a.4-5a.5), then \`handoff --machine=${choice.machine}\``);
        return choice.machine ? 0 : runs.some(r => r.code === 3) && !runs.some(r => r.code === 2) ? 3 : 1;
    }

    if (cmd === 'handoff') {
        const m = f.get('machine') as Machine | undefined;
        if (!m || !MACHINES.includes(m)) throw new Stop('--machine=run|twin is required');
        const env = f.get('scored-env');
        if (!env) throw new Stop("--scored-env=PATH (on the machine, relative to the checkout or absolute) is required");
        const maxAge = Number(f.get('max-gate-age') ?? '20');
        const choiceFile = f.get('choice') ?? join(logDir, 'choice.json');
        if (!existsSync(choiceFile)) throw new Stop(`no gate choice at ${choiceFile}: run \`gate\` first`);
        const choice = JSON.parse(readFileSync(choiceFile, 'utf8')) as { utc: string; rehearsal: boolean; choice: { machine: Machine | null } };
        if (choice.choice.machine !== m) throw new Stop(`the latest gate chose ${choice.choice.machine ?? 'no machine'}, not ${m}`);
        const age = (Date.now() - Date.parse(choice.utc)) / 60_000;
        if (age > maxAge) throw new Stop(`the gate is ${age.toFixed(0)} min old, over --max-gate-age=${maxAge}: gate again`);
        if (choice.rehearsal !== rehearsal) throw new Stop(`the gate was ${choice.rehearsal ? 'a rehearsal' : 'the run'}'s and this hand-off is ${rehearsal ? 'a rehearsal' : 'the run'}'s`);
        const extra = ['cap'].flatMap(k => (f.get(k) ? [`--${k}=${f.get(k)}`] : []));
        say(`[run-gate] hand-off on ${m}, gate ${age.toFixed(1)} min old`);
        const r = await remote(m, ['handoff', `--scored-env=${env}`, ...extra, ...pass], { checkout, stamp, bound: '12m', log });
        say(`[run-gate] hand-off on ${m}: ${r.code === 0 ? 'PASS' : `STOPPED (exit ${r.code})`}`);
        return r.code;
    }

    if (cmd === 'choice') {
        const file = f.get('choice') ?? join(logDir, 'choice.json');
        console.log(readFileSync(file, 'utf8'));
        return 0;
    }
    throw new Stop(`usage: run-gate.ts up|gate|handoff (see the header), or on-machine up|gate|handoff on a machine; not ${cmd ?? '(nothing)'}`);
}

if (import.meta.main) {
    const argv = process.argv.slice(2);
    const run = argv[0] === 'on-machine' ? onMachine(argv.slice(1)) : mac(argv);
    run.then(
        code => process.exit(code),
        e => {
            if (e instanceof Stop) {
                console.log(`STOP: ${e.message}`);
                process.exit(e.code);
            }
            console.log(`STOP: ${e instanceof Error ? e.message : String(e)}`);
            process.exit(2);
        }
    );
}
