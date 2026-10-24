// Lab acceptance for the keep-input (cairn://p/rs/648). The browser webclient logs a player out after
// 10 minutes of wall time with no input (lib/wait.ts CLIENT_IDLE_LOGOUT_MS), and in-page program
// clicks are not input. This holds SCORED's two kinds of long wait on real tabs, against an engine
// that honours IDLE_TIMER (NODE_DEBUG=false; the lab's default, debug on, ignores it):
//
//   NODE_DEBUG=false NODE_TICKRATE=400 SPEEDRUN_TICK_MS=400 LAB_RUNNERS=0 LAB_BOTS="<b> <c>" LAB_TIMEOUT=2700 \
//     speedrun/lab/lab.sh <a> 'speedrun/lab/keep-input-accept.ts:--held-bot=<b>:--band-bot=<c>'
//
// The page must be this checkout's bundle (`bun run build` in server/webclient first). Three bots,
// each with its own process and Chrome, run at once; <a>'s process starts the other two:
//   test (<a>)          held: runHandOffOnCue's wait for a cannon holder who never comes, for
//                       --held-ticks (900: 6 min at 400 ms), with the page's idle timer set back
//                       --preage-s (300) at its start, as if SCORED had sent nothing for 5 minutes
//                       before the wait. Then band: a knife-cycle willow band (woodcutting.ts
//                       bandParams, the run's own parameters) through awaitProgram for --band-ticks
//                       (1650: 11 min), nothing else sent. Then the timing comparison on the same
//                       account and trees, two pairs in opposite orders so load drift cannot pass
//                       for an effect: off, then off2 and on2, each --off-ticks (750) long.
// Each bot runs lib/tick-monitor.ts (one TICKMON line a minute); a minute with a tick gap stops that
// process (exit 3), and <a> then stops the rest: the lab yields to anything it shares a host with.
//   held-control (<b>)  the same held wait, the keep-input off.
//   band-control (<c>)  the same band at the Rimmington willows, the keep-input off: the client's
//                       own 10-minute rule, unaided.
// Committed code has no off switch: the controls run under a lab-batch patch, never committed, that
// makes keepInput() inert while RS648_KEEP_INPUT_OFF=1 (checked at start; a control refuses without it).
// Every 10 s each process reads its page (in game, ms since the client's last input) over DevTools,
// and at the end greps the engine log for its IdleTimerHandler line. One RESULT line per phase, and
// VERDICT lines from <a>.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BotWorldState } from '../../sdk/types';
import { programStatus, runProgram } from '../lib/programs';
import { closeSession, openSession, type Session } from '../lib/session';
import { evaluateInTab } from '../lib/tab';
import { startTickMonitor, tickMonLine } from '../lib/tick-monitor';
import { keepInput, waitTicks } from '../lib/wait';
import { handOffFrom, runHandOffOnCue } from '../runner/handoff';
import { bandParams, ROUTES, SITES } from '../skills/woodcutting';
import { launchLabBrowser } from './browser';
import { arg, botArg } from './common';
import { give, leaveTutorial, mustTele, setStats } from './setup';

type Role = 'test' | 'held-control' | 'band-control';
const bot = botArg();
const role = arg('role', 'test') as Role;
const heldTicks = Number(arg('held-ticks', '900'));
const bandTicks = Number(arg('band-ticks', '1650'));
const offTicks = Number(arg('off-ticks', '750'));
const preageMs = Number(arg('preage-s', '300')) * 1000;
const webPort = Number(process.env.WEB_PORT ?? '9300');
const cdpPort = webPort + ({ test: 5, 'held-control': 7, 'band-control': 8 } as const)[role];
const cdp = `http://127.0.0.1:${cdpPort}`;
const outFile = arg('out', '');

function emit(kind: string, data: Record<string, unknown>): void {
    const line = `${kind} ${role} ${JSON.stringify({ bot, ...data })}`;
    console.log(line);
    if (outFile) appendFileSync(outFile, line + '\n');
}

/** Whether keepInput() is inert in this process now (the lab batch's RS648_KEEP_INPUT_OFF patch). */
function keepInputOff(): boolean {
    let sent = false;
    let t = 0;
    const k = keepInput({ sendWait: async () => ((sent = true), { success: true, message: '' }) }, { now: () => t });
    t = 1e12;
    k.see({ tick: 1 } as BotWorldState);
    return !sent;
}

const PAGE = `(() => { const c = window.gameClient; return c ? { inGame: !!c.ingame, idleMs: Math.round(performance.now() - c.idleTimer) } : null; })()`;

interface PageWatch {
    stop(): { samples: number; maxIdleMs: number; outAfterMs: number | null; lastIdleMs: number | null; meanLoad1: number | null };
}

/** The host's 1-minute load average (Linux /proc/loadavg), or null. */
function load1(): number | null {
    try {
        return Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]);
    } catch {
        return null;
    }
}

/** The page every 10 s: the longest the client went without input, and when it first read out of the game; the host's load beside it. */
function watchPage(t0: number): PageWatch {
    let samples = 0;
    let maxIdleMs = 0;
    let lastIdleMs: number | null = null;
    let outAfterMs: number | null = null;
    const loads: number[] = [];
    const read = async () => {
        const l = load1();
        if (l !== null) loads.push(l);
        const r = await evaluateInTab<{ inGame: boolean; idleMs: number } | null>(cdp, bot, PAGE).catch(() => null);
        const v = r?.value;
        if (!v) return;
        samples++;
        if (v.inGame) {
            maxIdleMs = Math.max(maxIdleMs, v.idleMs);
            lastIdleMs = v.idleMs;
        } else if (outAfterMs === null) outAfterMs = Date.now() - t0;
    };
    const timer = setInterval(() => void read(), 10_000);
    return {
        stop: () => {
            clearInterval(timer);
            const meanLoad1 = loads.length ? Math.round((loads.reduce((a, b) => a + b, 0) / loads.length) * 100) / 100 : null;
            return { samples, maxIdleMs, outAfterMs, lastIdleMs, meanLoad1 };
        },
    };
}

/** The engine's IdleTimerHandler lines for this bot since `fromLine` (lab.sh's engine.log). */
function idleTimerLines(fromLine = 0): { lines: string[]; at: number } {
    const path = join(process.env.LAB_LOG ?? '', 'engine.log');
    if (!process.env.LAB_LOG || !existsSync(path)) return { lines: [], at: 0 };
    const all = readFileSync(path, 'utf8').split('\n');
    const mine = all.slice(fromLine).filter(l => /IdleTimerHandler/.test(l) && new RegExp(`for ${bot}\\b`, 'i').test(l));
    return { lines: mine, at: all.length };
}

const CANNON = `
| row | in | out | equip | needAtStart | source |
|---|---|---|---|---|---|
| H11 | cannon base x1 [u]; cannonball x100 [s]; mithril scimitar x1 [u] | - | - | 3 | fixture (r) |
`;

async function held(session: Session): Promise<Record<string, unknown>> {
    const sdk = session.sdk;
    const log0 = idleTimerLines().at;
    const set = await evaluateInTab<number>(cdp, bot, `(() => { const c = window.gameClient; c.idleTimer = performance.now() - ${preageMs}; return Math.round(performance.now() - c.idleTimer); })()`);
    const t0 = Date.now();
    const tick0 = sdk.getState()?.tick ?? 0;
    const page = watchPage(t0);
    let error: string | null = null;
    try {
        await runHandOffOnCue({ sdk }, handOffFrom(CANNON, 'H11'), 'rs648 nobody', { scope: { step: 'S14', family: 'cannon' }, open: async () => {}, waitTicks: heldTicks });
    } catch (e) {
        error = e instanceof Error ? e.message : String(e);
    }
    await Bun.sleep(3_000);
    const watched = page.stop();
    const idle = idleTimerLines(log0);
    const keepInputs = Number(/\((\d+) keep-inputs sent\)/.exec(error ?? '')?.[1] ?? NaN);
    return {
        preagedMs: set?.value ?? null, wallMs: Date.now() - t0, ticks: (sdk.getState()?.tick ?? 0) - tick0,
        expectedRefusal: !!error && /did not come into sight within/.test(error), keepInputs, error,
        page: watched, idleTimer: idle.lines.length, idleTimerLine: idle.lines[0] ?? null,
    };
}

async function band(session: Session, ticks: number): Promise<Record<string, unknown>> {
    const sdk = session.sdk;
    const p = bandParams(role === 'band-control' ? { route: 'rimmington' } : {}, 'willow', 99)('knife');
    delete p.untilLevel;
    const params: Record<string, unknown> = { ...p, maxTicks: ticks };
    const log0 = idleTimerLines().at;
    const t0 = Date.now();
    const tick0 = sdk.getState()?.tick ?? 0;
    const page = watchPage(t0);
    const inputs: number[] = [];
    let error: string | null = null;
    let end = null as ReturnType<typeof programStatus>;
    try {
        end = await runProgram(sdk, 'knife-cycle', params, { keepInput: { onInput: e => void inputs.push(e.tick - tick0) } });
    } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        end = programStatus(sdk.getState());
    }
    await Bun.sleep(3_000);
    const watched = page.stop();
    const idle = idleTimerLines(log0);
    const r = (end?.result ?? {}) as Record<string, unknown>;
    return {
        params: { method: params.method, trees: params.trees, maxTicks: ticks }, wallMs: Date.now() - t0, ticks: (sdk.getState()?.tick ?? 0) - tick0,
        ended: end?.phase ?? null, error, keepInputs: inputs.length, keepInputTicks: inputs,
        knife: {
            successes: r.successes, ticksPerSuccess: r.ticksPerSuccess, ticksPerExpectedRoll: r.ticksPerExpectedRoll, ticksPerSuccessOverSpan: r.ticksPerSuccessOverSpan,
            resyncs: r.resyncs, slips: end?.counters?.slips ?? 0, lateClicks: end?.counters?.lateClicks ?? 0, phaseResyncs: end?.counters?.phaseResyncs ?? 0,
            starters: end?.counters?.starters ?? 0, skippedTicks: end?.skippedTicks, deferred: end?.deferred, maxTickMs: end?.maxTickMs,
        },
        page: watched, idleTimer: idle.lines.length, idleTimerLine: idle.lines[0] ?? null,
    };
}

async function stage(session: Session): Promise<void> {
    const sdk = session.sdk;
    await leaveTutorial(session);
    while (sdk.getState()?.dialog.isOpen) await sdk.sendClickDialog(0);
    if (role === 'held-control') return;
    await setStats(sdk, { woodcutting: 60, hitpoints: 70, attack: 70, strength: 70, defence: 70 });
    for (const item of ['rune_axe', 'knife', 'logs']) await give(sdk, item);
    const stand = role === 'band-control' ? ROUTES.rimmington.willow.stand : SITES.willow.stand;
    await mustTele(sdk, stand[0], stand[1]);
    await waitTicks(sdk, 5);
}

function spawnControl(controlRole: Role, controlBot: string): ReturnType<typeof Bun.spawn> {
    return Bun.spawn(['bun', '--no-install', 'speedrun/lab/keep-input-accept.ts', controlBot, `--role=${controlRole}`, ...process.argv.slice(3).filter(a => !a.startsWith('--role=')), `--out=${outFile}`], {
        env: { ...process.env, RS648_KEEP_INPUT_OFF: '1' },
        stdout: 'inherit',
        stderr: 'inherit',
    });
}

const budget = setTimeout(() => {
    emit('RESULT', { error: 'over the script budget' });
    process.exit(2);
}, Number(arg('budget-s', '2400')) * 1000);

if (role !== 'test' && !keepInputOff()) {
    emit('RESULT', { error: 'a control needs the lab batch patch: keepInput() still sends with RS648_KEEP_INPUT_OFF=1' });
    process.exit(2);
}
if (role === 'test' && process.env.RS648_KEEP_INPUT_OFF) {
    emit('RESULT', { error: 'the test role must start with the keep-input on' });
    process.exit(2);
}

const children = role === 'test' ? [spawnControl('held-control', arg('held-bot', '')), spawnControl('band-control', arg('band-bot', ''))] : [];
const chrome = await launchLabBrowser(bot, { cdpPort });
let session: Session | null = null;
let exit = 0;

/** Close this bot's session and Chrome and exit `code`; on the test role, stop the controls first. */
async function shutdown(code: number): Promise<never> {
    for (const c of children) c.kill('SIGTERM');
    if (session) await closeSession(session).catch(() => {});
    await chrome.kill();
    process.exit(code);
}

// A control that stopped on a tick gap stops the whole lab.
for (const c of children) void c.exited.then(code => code === 3 && (emit('STOP', { why: 'a control saw a tick gap' }), void shutdown(3)));

/** The band with the keep-input switched off in this process (the lab batch patch), then back on. */
async function offBand(s: Session, ticks: number): Promise<Record<string, unknown>> {
    process.env.RS648_KEEP_INPUT_OFF = '1';
    try {
        if (!keepInputOff()) throw new Error('an off band needs the lab batch patch (keepInput() still sends with RS648_KEEP_INPUT_OFF=1)');
        return await band(s, ticks);
    } finally {
        delete process.env.RS648_KEEP_INPUT_OFF;
    }
}

try {
    session = await openSession(bot, { client: 'browser', launch: true, insecureQueryLogin: true });
    const monitor = startTickMonitor(session.sdk, {
        emit: m => {
            emit('TICKMON', { line: tickMonLine(m), load1: load1() });
            if (m.gaps > 0) {
                emit('STOP', { why: `tick gap in minute ${m.minute}`, line: tickMonLine(m) });
                void shutdown(3);
            }
        },
    });
    await stage(session);
    if (role === 'test' || role === 'held-control') emit('RESULT', { phase: 'held', keepInput: role === 'test', ...(await held(session)) });
    if (role === 'test' || role === 'band-control') emit('RESULT', { phase: 'band', keepInput: role === 'test', ...(await band(session, bandTicks)) });
    if (role === 'test') {
        emit('RESULT', { phase: 'off', keepInput: false, ...(await offBand(session, offTicks)) });
        emit('RESULT', { phase: 'off2', keepInput: false, ...(await offBand(session, offTicks)) });
        emit('RESULT', { phase: 'on2', keepInput: true, ...(await band(session, offTicks)) });
    }
    monitor.stop();
} catch (e) {
    emit('RESULT', { error: e instanceof Error ? e.stack ?? e.message : String(e) });
    exit = 1;
} finally {
    if (session) await closeSession(session).catch(() => {});
    await chrome.kill();
}
for (const c of children) await c.exited;
clearTimeout(budget);
process.exit(exit);
