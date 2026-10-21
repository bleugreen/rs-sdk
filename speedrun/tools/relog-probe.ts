#!/usr/bin/env bun
// Relog timing on one account, through the run's own path (rs/147, rs/174; SCORED's wine relogs, rs/158).
//
//   bun speedrun/tools/relog-probe.ts <bot> [--client=browser|lite] [--n=3] [--via=navigate|page|navigate,page]
//       [--bank] [--at=<x>,<z>] [--json=<file>]
//
// --at walks the account to that tile first (bot.walkTo, before any relog; Draynor's booths are
// beside 3092,3243), for --bank on an account that does not stand at a bank.
//
// From out of the world: log in (lib/session.ts openSession: on the browser, the tab navigated to a
// fresh one-time token over CDP), then N rounds of relogs, one per --via path in the order given,
// then a final `logoutClean`. The paths are session.ts `login`:
//   - navigate: the tab re-navigated to a fresh token URL (login's default);
//   - page:     login({ inPage: true }), the tab logging itself back in where it stands.
// Per relog it reports, in the new session's own ticks (state.tick - session.tickBase, so tick 1 is
// the session's first in-world tick on either path):
//   - the logout click to the confirmed out: ticks and ms, and the confirming signal;
//   - the confirmed out to login's return (the new session's tick advancing), ms;
//   - the new session's first state the SDK received: ms after the out, and its tick;
//   - with --bank, the first action: a click on the nearest bank booth sent the moment the new
//     session's first state shows one, and the tick the bank reads open (the wine step's bar is
//     open by login + 19). The account must stand next to a bank booth; the bank is closed again
//     before each logout, because the server does not remove a player with a modal open;
//   - on a browser tab with CDP, the page's own timeline from a 50 ms DevTools sampler: when the
//     new document started (navigate only), when it finished loading, when its login started,
//     when it entered the world, when it decoded its first tick, and when the overlay's gateway
//     socket was up, with the page's tick at that moment.
// The account must be out of combat (a hit within 16 ticks makes logoutClean wait the window out).
// SIGTERM or SIGINT logs out before exiting; the client is never killed to leave the world.

import { writeFileSync } from 'fs';
import type { BotWorldState } from '../../sdk/types';
import { type ClientKind, cdpUrl, closeSession, login, logoutClean, openSession, type Session } from '../lib/session';
import { botTabs, type CdpTarget } from '../lib/tab';
import { sleep, tickMs, waitTicks, waitUntil } from '../lib/wait';

export type Via = 'navigate' | 'page';

/** One DevTools read of the page; -1 where the page has no such member (yet). */
export interface PageSample {
    at: number;
    /** performance.timeOrigin: changes when a navigation loads a new document. */
    doc: number;
    progress: number;
    inGame: number;
    loggingIn: number;
    /** The overlay's client tick count (BotOverlay.serverTick). */
    tick: number;
    /** The overlay's gateway socket: 1 connected, 0 not, -1 no overlay. */
    gateway: number;
}

/** The page's timeline through one relog, ms after the confirmed out; ticks are the session's own. */
export interface PageTimeline {
    newDocumentMs: number | null;
    loadedMs: number | null;
    loginStartMs: number | null;
    inGameMs: number | null;
    firstTickMs: number | null;
    gatewayUpMs: number | null;
    /** The page's session tick when its gateway socket was first seen up (0: up throughout). */
    gatewayUpTick: number | null;
}

export interface RelogSample {
    relog: number;
    via: Via;
    /** How login actually got in ('launch' when an in-page login fell back to the navigation). */
    got: 'launch' | 'page';
    clickTick: number;
    lastInWorldTick: number;
    /** Click to the last in-world tick of the old session. */
    latencyTicks: number;
    confirmedBy: string | null;
    /** logoutClean's call to its confirmed return (the click is sent at once when out of combat). */
    clickToOutMs: number;
    /** Confirmed out to login's return (the new session's tick advancing). */
    outToInWorldMs: number;
    /** Confirmed out to the first in-world state of the new session the SDK received. */
    outToFirstStateMs: number | null;
    /** That state's session tick (state.tick - tickBase). */
    firstStateTick: number | null;
    tickBase: number;
    /** --bank: the session tick the booth click was sent on, and the tick the bank read open. */
    bankClickTick: number | null;
    bankOpenTick: number | null;
    page: PageTimeline | null;
    loginAttempts: number;
}

function arg(name: string): string | undefined {
    return process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const SAMPLE_EXPRESSION = `(() => {
    const c = window.gameClient;
    const o = c && c.botOverlay;
    const g = o && o.gateway;
    return [performance.timeOrigin, c ? c.lastProgressPercent : -1, c ? (c.ingame ? 1 : 0) : -1, c ? (c.loginInProgress ? 1 : 0) : -1,
        o && typeof o.serverTick === 'number' ? o.serverTick : -1, g ? (g.connected ? 1 : 0) : -1];
})()`;

/**
 * Reads the page over one DevTools socket every `everyMs` and keeps the samples where anything
 * changed. A read is stamped at the midpoint of its round trip.
 */
export class PageSampler {
    readonly samples: PageSample[] = [];
    private ws: WebSocket | null = null;
    private nextId = 1;
    private readonly waiting = new Map<number, (v: unknown) => void>();
    private stopped = false;
    private done: Promise<void> | null = null;

    constructor(
        private readonly wsUrl: string,
        private readonly everyMs = 50
    ) {}

    start(): void {
        this.done = this.loop();
    }

    async stop(): Promise<void> {
        this.stopped = true;
        await this.done;
        this.ws?.close();
    }

    private open(): Promise<WebSocket> {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(this.wsUrl);
            ws.onopen = () => resolve(ws);
            ws.onerror = () => reject(new Error('sampler: DevTools socket error'));
            ws.onclose = () => {
                if (this.ws === ws) this.ws = null;
            };
            ws.onmessage = ev => {
                const msg = JSON.parse(String(ev.data)) as { id?: number; result?: { result?: { value?: unknown } } };
                if (msg.id === undefined) return;
                this.waiting.get(msg.id)?.(msg.result?.result?.value);
                this.waiting.delete(msg.id);
            };
        });
    }

    private async read(): Promise<unknown> {
        this.ws ??= await this.open();
        const id = this.nextId++;
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                this.waiting.delete(id);
                resolve(null);
            }, 1_000);
            this.waiting.set(id, v => {
                clearTimeout(timer);
                resolve(v);
            });
            this.ws!.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: SAMPLE_EXPRESSION, returnByValue: true } }));
        });
    }

    private async loop(): Promise<void> {
        while (!this.stopped) {
            const t0 = Date.now();
            const v = await this.read().catch(() => null);
            const t1 = Date.now();
            if (Array.isArray(v) && v.length === 6) {
                const [doc, progress, inGame, loggingIn, tick, gateway] = v as number[];
                const s: PageSample = { at: Math.round((t0 + t1) / 2), doc: doc!, progress: progress!, inGame: inGame!, loggingIn: loggingIn!, tick: tick!, gateway: gateway! };
                const last = this.samples[this.samples.length - 1];
                if (!last || last.doc !== s.doc || last.progress !== s.progress || last.inGame !== s.inGame || last.loggingIn !== s.loggingIn || last.tick !== s.tick || last.gateway !== s.gateway) {
                    this.samples.push(s);
                }
            }
            await sleep(Math.max(0, this.everyMs - (Date.now() - t0)));
        }
    }
}

/**
 * The page's timeline through one relog from the sampler's changes: `out` is the confirmed out
 * (wall ms), `end` when the measurement ended, `tickBase` the new session's base (0 after a
 * navigation, whose new document counts from 0).
 */
export function pageTimeline(samples: readonly PageSample[], out: number, end: number, tickBase: number): PageTimeline {
    const before = samples.filter(s => s.at <= out).pop();
    const after = samples.filter(s => s.at > out && s.at <= end);
    const ms = (s: PageSample | undefined) => (s ? s.at - out : null);
    const newDoc = before ? after.find(s => s.doc !== before.doc) : undefined;
    // In the new document when there is one; otherwise the same page from the out on.
    const session = newDoc ? after.filter(s => s.doc === newDoc.doc) : after;
    const gatewayUp = before && !newDoc && before.gateway === 1 && session.every(s => s.gateway !== 0) ? before : session.find(s => s.gateway === 1);
    return {
        newDocumentMs: ms(newDoc),
        loadedMs: newDoc ? ms(session.find(s => s.progress >= 100)) : null,
        loginStartMs: ms(session.find(s => s.loggingIn === 1)),
        inGameMs: ms(session.find(s => s.inGame === 1)),
        firstTickMs: ms(session.find(s => s.inGame === 1 && s.tick > tickBase)),
        gatewayUpMs: gatewayUp === before ? (gatewayUp ? 0 : null) : ms(gatewayUp),
        gatewayUpTick: gatewayUp === before ? (gatewayUp ? 0 : null) : gatewayUp ? Math.max(0, gatewayUp.tick - tickBase) : null,
    };
}

const cell = (v: number | string | null, w: number) => String(v ?? '-').padStart(w);

export function formatSamples(samples: readonly RelogSample[], msPerTick: number): string[] {
    const lines = [
        `ticks are the new session's own (1 = its first in-world tick); ms are from the confirmed out; ${msPerTick} ms per tick`,
        'relog  via       got     click->out  out->in-world  first SDK state (ms, tick)  bank click  bank open  | page: new doc  loaded  login  in world  1st tick  gateway up (ms, tick)',
    ];
    for (const s of samples) {
        const p = s.page;
        lines.push(
            `${cell(s.relog, 5)}  ${s.via.padEnd(8)}  ${s.got.padEnd(6)}  ${cell(s.clickToOutMs, 7)} ms  ${cell(s.outToInWorldMs, 10)} ms  ` +
                `${cell(s.outToFirstStateMs, 15)}, ${cell(s.firstStateTick, 5)}     ${cell(s.bankClickTick, 9)}  ${cell(s.bankOpenTick, 9)}  | ` +
                (p
                    ? `${cell(p.newDocumentMs, 7)}  ${cell(p.loadedMs, 6)}  ${cell(p.loginStartMs, 5)}  ${cell(p.inGameMs, 8)}  ${cell(p.firstTickMs, 8)}  ${cell(p.gatewayUpMs, 10)}, ${cell(p.gatewayUpTick, 4)}`
                    : 'no page timeline')
        );
    }
    return lines;
}

async function playerCount(session: Session): Promise<number | null> {
    const host = session.env.SERVER;
    if (!host) return null;
    const base = /^https?:/.test(host) ? host : host.startsWith('localhost') || host.startsWith('127.') ? `http://${host}` : `https://${host}`;
    try {
        const body = (await (await fetch(`${base}/playercount`, { signal: AbortSignal.timeout(5_000) })).json()) as { count?: number } | number;
        return typeof body === 'number' ? body : (body.count ?? null);
    } catch {
        return null;
    }
}

function nearestBooth(s: BotWorldState) {
    // As BotActions.findUsableBankBooth: Draynor's "Closed bank booth"s have no bank option.
    const booths = s.nearbyLocs.filter(l => /bank booth|bank chest/i.test(l.name) && !/^closed/i.test(l.name)).sort((a, b) => a.distance - b.distance);
    for (const booth of booths) {
        const op = booth.optionsWithIndex.find(o => /^bank$/i.test(o.text)) ?? booth.optionsWithIndex.find(o => /use.quickly/i.test(o.text));
        if (op) return { x: booth.x, z: booth.z, id: booth.id, op: op.opIndex };
    }
    return null;
}

async function main(): Promise<number> {
    const bot = process.argv.slice(2).find(a => !a.startsWith('--'));
    if (!bot) {
        console.error('usage: bun speedrun/tools/relog-probe.ts <bot> [--client=browser|lite] [--n=3] [--via=navigate|page|navigate,page] [--bank] [--json=<file>]');
        return 2;
    }
    const client = (arg('client') ?? 'browser') as ClientKind;
    const n = Number(arg('n') ?? 3);
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error(`--n must be 1 to 10, not ${arg('n')}`);
    const vias = (arg('via') ?? 'navigate').split(',') as Via[];
    if (vias.some(v => v !== 'navigate' && v !== 'page')) throw new Error(`--via takes navigate, page or both, not ${arg('via')}`);
    if (client !== 'browser' && vias.includes('page')) throw new Error('--via=page needs the browser client');
    const bank = process.argv.includes('--bank');
    const at = arg('at')?.split(',').map(Number);
    if (at && (at.length !== 2 || at.some(v => !Number.isInteger(v)))) throw new Error(`--at takes x,z, not ${arg('at')}`);

    const session: Session = await openSession(bot, { client, launch: true, pathfinding: at !== undefined });
    console.log(`[relog] ${session.name}: in the world (session ${session.sessionId}, tick ${session.lastInWorldTick})`);
    let leaving = false;
    const leave = (code: number) => async () => {
        if (leaving) return;
        leaving = true;
        if (session.expectInWorld) console.log(`[relog] signal: logout ${JSON.stringify(await logoutClean(session).catch(e => String(e)))}`);
        process.exit(code);
    };
    process.on('SIGTERM', leave(143));
    process.on('SIGINT', leave(130));

    let sampler: PageSampler | null = null;
    const cdp = client === 'browser' ? cdpUrl(session.env) : undefined;
    if (cdp) {
        const [tab] = botTabs((await (await fetch(`${cdp.replace(/\/+$/, '')}/json/list`)).json()) as CdpTarget[], session.name);
        if (tab?.webSocketDebuggerUrl) {
            sampler = new PageSampler(tab.webSocketDebuggerUrl);
            sampler.start();
        }
    }

    // The new session's states, from the out on: the first one, and the --bank click and opening.
    type Watch = { oldTick: number; first: { at: number; tick: number } | null; bankClick: number | null; bankOpen: number | null; base: () => number };
    let watch: Watch | null = null;
    session.sdk.onStateUpdate(s => {
        const w = watch;
        if (!w || !s.inGame || s.tick === w.oldTick || session.lastAdvanceAt < session.launchedAt) return;
        if (!w.first) w.first = { at: Date.now(), tick: s.tick };
        if (!bank) return;
        if (w.bankClick === null) {
            const b = nearestBooth(s);
            if (b) {
                w.bankClick = s.tick - w.base();
                void session.sdk.sendInteractLoc(b.x, b.z, b.id, b.op).catch(() => {});
            }
        } else if (w.bankOpen === null && s.bank.isOpen) w.bankOpen = s.tick - w.base();
    });

    const players: (number | null)[] = [await playerCount(session)];
    const samples: RelogSample[] = [];
    let relog = 0;
    try {
        if (at) {
            const walked = await session.bot.walkTo(at[0]!, at[1]!, 1);
            if (!walked.success) throw new Error(`--at: walk to ${at.join(',')} failed (${walked.message})`);
            if (bank) {
                // Onto the booth tile itself (openBank steps there), as the wine step stands, then shut it.
                const opened = await session.bot.openBank();
                if (!opened.success) throw new Error(`--at: openBank failed (${opened.message})`);
                await session.sdk.sendCloseModal();
                await waitUntil(session.sdk, s => !s.bank.isOpen, { maxTicks: 10 });
            }
            await waitTicks(session.sdk, 2);
        }
        // A fresh login's first states come before the scene has its locs: wait for the booth.
        if (bank && !(await waitUntil(session.sdk, s => nearestBooth(s) !== null, { maxTicks: 30 })).ok) {
            throw new Error('--bank: no bank booth in sight; stand the account next to one first');
        }
        for (let round = 1; round <= n; round++) {
            for (const via of vias) {
                relog++;
                await waitTicks(session.sdk, 3);
                const tClick = Date.now();
                const out = await logoutClean(session);
                const tOut = Date.now();
                if (!out.ok) throw new Error(`relog ${relog}: logout not confirmed (${out.reason})`);
                const w: Watch = { oldTick: session.lastInWorldTick, first: null, bankClick: null, bankOpen: null, base: () => session.tickBase };
                watch = w;
                const li = await login(session, { inPage: via === 'page' });
                const tIn = Date.now();
                if (bank) {
                    await waitUntil(session.sdk, s => s.bank.isOpen, { maxTicks: 40 });
                    await waitTicks(session.sdk, 1);
                    if (session.sdk.getState()?.bank.isOpen) await session.sdk.sendCloseModal();
                    await waitUntil(session.sdk, s => !s.bank.isOpen, { maxTicks: 10 });
                }
                await waitTicks(session.sdk, 2);
                watch = null;
                samples.push({
                    relog, via, got: li.via, clickTick: out.clickTick, lastInWorldTick: out.lastInWorldTick, latencyTicks: out.latencyTicks, confirmedBy: out.confirmedBy ?? null,
                    clickToOutMs: tOut - tClick, outToInWorldMs: tIn - tOut,
                    outToFirstStateMs: w.first ? w.first.at - tOut : null, firstStateTick: w.first ? w.first.tick - li.tickBase : null, tickBase: li.tickBase,
                    bankClickTick: w.bankClick, bankOpenTick: w.bankOpen,
                    page: sampler ? pageTimeline(sampler.samples, tOut, Date.now(), li.tickBase) : null,
                    loginAttempts: li.attempts,
                });
                console.log(`[relog] ${relog}: ${JSON.stringify(samples[samples.length - 1])}`);
            }
        }
        await waitTicks(session.sdk, 3);
    } finally {
        if (session.expectInWorld) {
            const out = await logoutClean(session);
            console.log(`[relog] final logout: ${out.ok ? `confirmed by ${out.confirmedBy}, click on tick ${out.clickTick}, ${out.wallMs} ms` : `NOT confirmed (${out.reason})`}`);
        }
        await sampler?.stop();
    }
    players.push(await playerCount(session));
    console.log(`[relog] players online: ${players.map(p => p ?? '?').join(' -> ')}`);
    for (const l of formatSamples(samples, tickMs())) console.log(l);
    const json = arg('json');
    if (json) writeFileSync(json, JSON.stringify({ account: session.name, client, msPerTick: tickMs(), players, samples, pageSamples: sampler?.samples ?? [] }, null, 2) + '\n');
    await closeSession(session);
    return 0;
}

if (import.meta.main) process.exit(await main());
