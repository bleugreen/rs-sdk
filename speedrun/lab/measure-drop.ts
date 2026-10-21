// Drop-to-leave: how many ticks a player stays in the world after its client
// drops, measured on the engine's own playtime counter.
//
//   LAB_RUNNERS=0 NODE_TICKRATE=300 speedrun/lab/lab.sh srlab1 \
//     speedrun/lab/measure-drop.ts:--scenario=kill:--bot=srdrop1
//
// Scenarios (--scenario=a,b,... runs several in order):
//   kill        SIGKILL the lite runner mid-world (the OS closes its socket)
//   kill-early  SIGKILL it the moment it logs in, before its first advancing tick
//   sever       the network goes silent: a TCP proxy between runner and engine
//               stops forwarding in both directions and keeps both sockets open
//   orphan      the controlling script crashes after openSession({launch:true});
//               does the runner outlive it, and does the player stay?
//   wd-mute     startWatchdog running; the runner's state stops reaching the
//               gateway while actions still reach the runner (a wedged relay:
//               the SDK sees no ticks, but a logout click can still land)
//   wd-frozen   startWatchdog running; the runner process is SIGSTOPped
//   wd-kill     startWatchdog running; the runner is SIGKILLed
//
// The oracle is `playtime` in the player's save (PlayerLoading.ts: a g4s at
// byte 24), which the engine increments once per tick in the player loop
// (World.ts processClientsIn) and writes when the player is removed. A
// baseline session (log in, wait, clean logout) gives the offset between the
// client's tick counter and the saved playtime, so
//   ticks in the world after the drop = P1 - P0 - offset - (client tick at the drop).
// The bot connects through a local proxy so the sever scenario can cut it; the
// script rewrites bots/<bot>/bot.env to point at the proxy.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import net from 'node:net';
import { join } from 'path';
import { ROOT, closeSession, logoutClean, openSession, startWatchdog, type Session, type WatchdogEvent } from '../lib/session';
import { sleep, tickMs, waitTicks } from '../lib/wait';
import { arg, normName, result } from './common';

const WEB_PORT = Number(process.env.WEB_PORT ?? 9300);
const AGENT_PORT = Number(process.env.AGENT_PORT ?? 8300);
const PROXY_PORT = Number(arg('proxy-port', '9310'));
const GW_PROXY_PORT = Number(arg('gw-proxy-port', '8310'));
const ENGINE_LOG = join(process.env.LAB_LOG ?? join(process.env.TMPDIR ?? '/tmp', 'speedrun-lab'), 'engine.log');
const PLAYERS = join(ROOT, 'server', 'engine', 'data', 'players');
const BOT = arg('bot', 'srdrop1');
const MAX_LEAVE_TICKS = Number(arg('max-leave-ticks', '1400'));

// ------------------------------------------------------------------ oracle

function savePath(name: string): string | null {
    if (!existsSync(PLAYERS)) return null;
    for (const profile of readdirSync(PLAYERS)) {
        const p = join(PLAYERS, profile, `${name.toLowerCase()}.sav`);
        if (existsSync(p)) return p;
    }
    return null;
}

function playtime(name: string): number | null {
    const p = savePath(name);
    if (!p) return null;
    const b = readFileSync(p);
    return new DataView(b.buffer, b.byteOffset, b.byteLength).getInt32(24);
}

async function online(name: string): Promise<boolean> {
    const res = await fetch(`http://localhost:${WEB_PORT}/playerpositions`);
    const list = (await res.json()) as { name: string }[];
    return list.some(p => normName(p.name) === normName(name));
}

/** Wait until the engine removes the player and writes a new save. */
async function waitLeave(name: string, before: number | null, maxTicks = MAX_LEAVE_TICKS): Promise<{ left: boolean; wallMs: number; playtime: number | null }> {
    const t0 = Date.now();
    let lastLog = t0;
    while (Date.now() - t0 < maxTicks * tickMs()) {
        const pt = playtime(name);
        if (!(await online(name)) && pt !== null && pt !== before) return { left: true, wallMs: Date.now() - t0, playtime: pt };
        if (Date.now() - lastLog > 30_000) {
            lastLog = Date.now();
            console.log(`  still in the world after ${Math.round((Date.now() - t0) / tickMs())} ticks (wall)`);
        }
        await sleep(250);
    }
    return { left: false, wallMs: Date.now() - t0, playtime: playtime(name) };
}

function engineLogSize(): number {
    return existsSync(ENGINE_LOG) ? statSync(ENGINE_LOG).size : 0;
}

/** The engine's own LOGOUT DEBUG lines for this bot since `from` (byte offset). */
function engineLines(name: string, from: number): string[] {
    if (!existsSync(ENGINE_LOG)) return [];
    const text = readFileSync(ENGINE_LOG).subarray(from).toString('utf-8');
    const n = name.toLowerCase();
    return text.split('\n').filter(l => l.toLowerCase().includes(n) && /LOGOUT DEBUG|session/i.test(l)).map(l => l.slice(0, 220));
}

// ------------------------------------------------------------------ proxy

type PairMode = 'pass' | 'severed' | 'mute-up';
interface Pair { c: net.Socket; u: net.Socket; mode: PairMode; created: number; ws: boolean }

/**
 * A TCP relay that can go silent. 'severed' drops bytes both ways and never
 * propagates a close, like a NAT or Wi-Fi drop: neither end hears a FIN.
 * 'mute-up' drops only client-to-upstream bytes.
 */
class Relay {
    readonly pairs = new Set<Pair>();
    constructor(readonly listenPort: number, readonly upstreamPort: number) {
        net.createServer(c => {
            const u = net.connect(upstreamPort, '127.0.0.1');
            const pair: Pair = { c, u, mode: 'pass', created: Date.now(), ws: false };
            this.pairs.add(pair);
            let first = true;
            c.on('data', d => {
                if (first) {
                    first = false;
                    pair.ws = /upgrade:\s*websocket/i.test(d.toString('latin1'));
                }
                if (pair.mode === 'pass') u.write(d);
            });
            u.on('data', d => {
                if (pair.mode !== 'severed') c.write(d);
            });
            const end = () => {
                this.pairs.delete(pair);
                if (pair.mode === 'pass') {
                    c.destroy();
                    u.destroy();
                }
            };
            c.on('close', end);
            u.on('close', end);
            c.on('error', () => {});
            u.on('error', () => {});
        }).listen(listenPort, '127.0.0.1');
    }
    /** Apply `mode` to every connection open now (later connections pass). */
    set(mode: PairMode): number {
        for (const p of this.pairs) p.mode = mode;
        return this.pairs.size;
    }
    /**
     * Mute the newest open websocket only. On the gateway relay that is the lite
     * runner's: openSession connects the SDK right after spawning the runner,
     * which reaches the gateway only after it has logged in.
     */
    muteNewestWebsocket(): number {
        const ws = [...this.pairs].filter(p => p.ws).sort((a, b) => b.created - a.created);
        if (ws[0]) ws[0].mode = 'mute-up';
        return ws.length;
    }
}

function pointBotAtRelay(name: string): void {
    const dir = join(ROOT, 'bots', name);
    const path = join(dir, 'bot.env');
    const password = existsSync(path) ? (/^PASSWORD=(.*)$/m.exec(readFileSync(path, 'utf-8'))?.[1] ?? 'droplab1') : 'droplab1';
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, [`BOT_USERNAME=${name}`, `PASSWORD=${password}`, `SERVER=localhost:${PROXY_PORT}`, `GATEWAY_URL=ws://localhost:${GW_PROXY_PORT}`, 'SHOW_CHAT=false', 'TELEMETRY=false', ''].join('\n'));
}

// ------------------------------------------------------------------ helpers

async function open(): Promise<Session> {
    return openSession(BOT, { launch: true, pathfinding: false, readyTimeoutMs: 90_000 });
}

/** A clean session gives P0 and the offset between client ticks and saved playtime. */
async function baseline(): Promise<{ p0: number; offset: number }> {
    if (playtime(BOT) === null) {
        const s = await open();
        await waitTicks(s.sdk, 3);
        await logoutClean(s);
        await closeSession(s);
        await sleep(1_000);
    }
    const before = playtime(BOT)!;
    const s = await open();
    await waitTicks(s.sdk, 10);
    const out = await logoutClean(s);
    await closeSession(s);
    const left = await waitLeave(BOT, before, 50);
    const p0 = left.playtime!;
    const offset = p0 - before - out.lastInWorldTick;
    result('baseline', { before, after: p0, clickTick: out.clickTick, lastInWorldTick: out.lastInWorldTick, latencyTicks: out.latencyTicks, offset });
    await sleep(2_000);
    return { p0, offset };
}

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

// ------------------------------------------------------------------ scenarios

async function dropScenario(name: string, relay: Relay, drop: (s: Session) => void | Promise<void>): Promise<void> {
    const { p0, offset } = await baseline();
    const s = await open();
    await waitTicks(s.sdk, 20);
    const dropTick = s.lastInWorldTick;
    const logFrom = engineLogSize();
    await drop(s);
    const left = await waitLeave(BOT, p0);
    const inWorldAfter = left.playtime === null ? null : left.playtime - p0 - offset - dropTick;
    result(name, { left: left.left, dropTick, p0, p1: left.playtime, offset, ticksInWorldAfterDrop: left.left ? inWorldAfter : `> ${Math.round(left.wallMs / tickMs())} (wall)`, wallTicks: Math.round(left.wallMs / tickMs()), engine: engineLines(BOT, logFrom) });
    await closeSession(s);
    relay.set('pass');
    await sleep(2_000);
}

async function killEarly(): Promise<void> {
    const { p0, offset } = await baseline();
    const logFrom = engineLogSize();
    const child = Bun.spawn(['bun', 'src/lite/runner.ts', BOT], { cwd: join(ROOT, 'server', 'webclient'), stdout: 'pipe', stderr: 'inherit', env: { ...process.env } });
    const reader = child.stdout.getReader();
    let buf = '';
    const t0 = Date.now();
    while (Date.now() - t0 < 60_000) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += new TextDecoder().decode(value);
        if (buf.includes('logged into')) break;
    }
    child.kill('SIGKILL');
    await child.exited;
    const left = await waitLeave(BOT, p0);
    result('kill-early', { left: left.left, p0, p1: left.playtime, offset, ticksInWorldAfterDrop: left.playtime === null ? null : left.playtime - p0 - offset, wallTicks: Math.round(left.wallMs / tickMs()), engine: engineLines(BOT, logFrom) });
    await sleep(2_000);
}

/** Child mode for `orphan`: open a launched session, report, then crash. */
async function orphanChild(): Promise<void> {
    const s = await open();
    await waitTicks(s.sdk, 10);
    console.log(`ORPHAN ${JSON.stringify({ runnerPid: s.child!.pid, tick: s.lastInWorldTick })}`);
    throw new Error('simulated crash after openSession');
}

async function orphan(): Promise<void> {
    const observeTicks = Number(arg('observe-ticks', '1300'));
    const { p0, offset } = await baseline();
    const logFrom = engineLogSize();
    const proc = Bun.spawn(['bun', import.meta.path, `--bot=${BOT}`, '--child=orphan'], { cwd: ROOT, stdout: 'pipe', stderr: 'inherit', env: { ...process.env } });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    const info = JSON.parse(/ORPHAN (\{.*\})/.exec(out)?.[1] ?? '{}') as { runnerPid?: number; tick?: number };
    const runnerAliveAfterParentExit = info.runnerPid ? alive(info.runnerPid) : null;
    result('orphan parent exit', { parentExitCode: code, ...info, runnerAliveAfterParentExit });

    // Watch the player for observeTicks of wall time.
    const t0 = Date.now();
    let stillOnline = true;
    while (Date.now() - t0 < observeTicks * tickMs()) {
        stillOnline = await online(BOT);
        if (!stillOnline) break;
        await sleep(1_000);
    }
    const wallTicks = Math.round((Date.now() - t0) / tickMs());
    let inWorld: unknown = null;
    if (stillOnline && info.runnerPid && alive(info.runnerPid)) {
        // Clean up through the orphan itself: attach and log out.
        const s = await openSession(BOT, { pathfinding: false, readyTimeoutMs: 30_000 });
        s.child = null;
        const lo = await logoutClean(s);
        await closeSession(s);
        await waitLeave(BOT, p0, 60);
        const p1 = playtime(BOT)!;
        inWorld = { p1, totalSessionTicks: p1 - p0 - offset, ticksAfterCrash: p1 - p0 - offset - (info.tick ?? 0), logoutLastInWorldTick: lo.lastInWorldTick };
        for (let i = 0; i < 20 && alive(info.runnerPid); i++) await sleep(250);
    } else if (!stillOnline) {
        await sleep(1_000);
        const p1 = playtime(BOT)!;
        inWorld = { p1, ticksAfterCrash: p1 - p0 - offset - (info.tick ?? 0) };
    }
    result('orphan', { observedWallTicks: wallTicks, stillOnlineAtEnd: stillOnline, runnerAliveAtEnd: info.runnerPid ? alive(info.runnerPid) : null, inWorld, engine: engineLines(BOT, logFrom) });
    await sleep(2_000);
}

/**
 * Watchdog scenarios: wedge the client with startWatchdog running and measure
 * the ticks from the wedge to the old session leaving the world (by a clean
 * logout, or by a relaunched client taking the session over).
 */
async function watchdogScenario(name: string, gw: Relay, wedge: (s: Session) => void | Promise<void>): Promise<void> {
    const { p0, offset } = await baseline();
    const s = await open();
    const events: (WatchdogEvent & { savedPlaytime?: number | null })[] = [];
    const wd = startWatchdog(s, {
        onEvent: e => events.push({ ...e, savedPlaytime: playtime(BOT) }),
    });
    await waitTicks(s.sdk, 20);
    const wedgeTick = s.lastInWorldTick;
    const wedgePid = s.child!.pid;
    const logFrom = engineLogSize();
    const t0 = Date.now();
    await wedge(s);
    // Wait for the watchdog to bring the account back into the world on a new client.
    while (Date.now() - t0 < 120_000) {
        if (s.sessionId > 1 && s.lastAdvanceAt > s.launchedAt && s.expectInWorld && s.lastInWorldTick > 3) break;
        await sleep(100);
    }
    const backMs = Date.now() - t0;
    gw.set('pass');
    await waitTicks(s.sdk, 5).catch(() => {});
    wd.stop();
    const out = await logoutClean(s);
    await closeSession(s);
    const left = await waitLeave(BOT, null, 60);
    try {
        process.kill(wedgePid, 'SIGCONT');
        process.kill(wedgePid, 'SIGKILL');
    } catch {}
    const pEnd = left.playtime!;
    // In-world ticks of the second client are its own tick count at logout.
    const secondTicks = out.lastInWorldTick;
    const loggedOut = events.find(e => e.verdict === 'logout' && /logged out/.test(e.reason));
    const p1 = loggedOut?.savedPlaytime ?? null;
    result(name, {
        wedgeTick,
        events: events.map(e => ({ dtTicks: Math.round((e.at - t0) / tickMs()), verdict: e.verdict, reason: e.reason, session: e.sessionId, savedPlaytime: e.savedPlaytime })),
        backInWorldWallTicks: Math.round(backMs / tickMs()),
        // Clean-logout path: the save written by the watchdog's logout.
        ticksWedgeToLeave_fromLogoutSave: p1 !== null && p1 !== p0 ? p1 - p0 - offset - wedgeTick : null,
        // Either path: everything in the world minus both clients' own ticks.
        ticksWedgeToOldSessionGone: pEnd - p0 - offset - wedgeTick - secondTicks - (p1 !== null && p1 !== p0 ? offset : 0),
        p0, p1, pEnd, offset, secondTicks,
        engine: engineLines(BOT, logFrom),
    });
    await sleep(2_000);
}

// ------------------------------------------------------------------ main

if (arg('child', '') === 'orphan') {
    await orphanChild();
} else {
    pointBotAtRelay(BOT);
    const game = new Relay(PROXY_PORT, WEB_PORT);
    const gw = new Relay(GW_PROXY_PORT, AGENT_PORT);
    console.log(`measure-drop: bot ${BOT}, tick ${tickMs()} ms, relay :${PROXY_PORT} -> :${WEB_PORT}, gateway relay :${GW_PROXY_PORT} -> :${AGENT_PORT}`);
    for (const sc of arg('scenario', 'kill').split(',')) {
        console.log(`--- ${sc}`);
        if (sc === 'kill') await dropScenario('kill', game, s => void s.child!.kill('SIGKILL'));
        else if (sc === 'kill-early') await killEarly();
        else if (sc === 'sever') await dropScenario('sever', game, () => void result('severed connections', game.set('severed')));
        else if (sc === 'orphan') await orphan();
        else if (sc === 'wd-mute') await watchdogScenario('wd-mute', gw, () => void result('muted the runner of open gateway websockets', gw.muteNewestWebsocket()));
        else if (sc === 'wd-frozen') await watchdogScenario('wd-frozen', gw, s => void process.kill(s.child!.pid, 'SIGSTOP'));
        else if (sc === 'wd-kill') await watchdogScenario('wd-kill', gw, s => void s.child!.kill('SIGKILL'));
        else throw new Error(`unknown scenario ${sc}`);
    }
    process.exit(0);
}
