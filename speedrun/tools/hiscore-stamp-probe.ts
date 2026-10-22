#!/usr/bin/env bun
// Hiscore stamp probe: what the time on a demo hiscore row means.
//
//   bun speedrun/tools/hiscore-stamp-probe.ts page <player>...      rows with exact ticks, as JSON
//   bun speedrun/tools/hiscore-stamp-probe.ts classify <player>...  stamp ordering and batches per player
//   bun speedrun/tools/hiscore-stamp-probe.ts live <bot> <phase>    one session of the live test
//
// page and classify read the current page uncached, one a second ($PROBE_DELAY_MS);
// they print what `hiscore-scrape.ts players` + `analyze` would, without a snapshot.
// Parsing and stamp grouping live in hiscore-scrape.ts (parsePlayer, analyzeAccount).
//
// The board shows a time per row; the exact stamp is in the hover title of
// each time: `<span title="12,006 ticks">` on the engine's own page
// (web/pages/hiscores.ts), `<span title="3,601.8 seconds of game time">`
// (S = 0.3 x ticks, tick rate unchanged) on the demo since about 19:34 UTC
// 2026-10-22, `N ticks normalized to M ms per tick` since its ~19:56Z restart; titleTicks reads all three. The
// player page reads its rows straight from the database, so it shows a write
// as soon as the login server makes it (only the rank column is cached).
//
// Live phases: each one logs in (lite client), works, watches the board while
// still in the world, logs out cleanly, then watches the board again.
//   recon  look around (position, kit, skills), log out
//   a      chop to Woodcutting 15+, stay in the world for 1550 ticks (more than
//          one 1500-tick autosave period), log out
//   c      one more Woodcutting level, idle 200 ticks, log out
//   d      Firemaking to 15+, idle 200 ticks, log out
// Every event is a JSONL line in $PROBE_LOG (default
// speedrun/runs/hiscore-probe-<bot>.jsonl). Ticks are the client's count of
// server ticks since this session's login; the server's playtime differs by a
// per-account offset that the level-up stamps measure.
//
// The test account must stay out of other players' way (tenet 6): it only
// chops normal trees and burns logs, and never trades, talks or attacks.

import { appendFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import type { BotWorldState } from '../../sdk/types';
import { ROOT, closeSession, logoutClean, openSession, type Session } from '../lib/session';
import { sleep, waitTicks } from '../lib/wait';
import { BASE_URL, analyzeAccount, isStamped, parsePlayer, playerPath, renderAnalysis, type PlayerRow } from './hiscore-scrape';

const ORIGIN = process.env.HISCORE_ORIGIN ?? BASE_URL;

// ------------------------------------------------------------------ board

/** The player's rows read fresh from the page, or null when the account has no page. */
export async function fetchPlayer(name: string): Promise<PlayerRow[] | null> {
    const res = await fetch(ORIGIN + playerPath(name), { headers: { 'cache-control': 'no-cache' } });
    // A missing player is a 404 whose "not found" body parsePlayer reads as null.
    if (!res.ok && res.status !== 404) throw new Error(`hiscores ${name}: HTTP ${res.status}`);
    return parsePlayer(await res.text());
}

function present(rows: PlayerRow[] | null): PlayerRow[] {
    return (rows ?? []).filter(isStamped);
}

/** The fields the live test watches; rank is left out because it moves with other players. */
const brief = (rows: PlayerRow[]) => rows.map(r => ({ c: r.category, name: r.skill, level: r.level, ticks: r.ticks }));

const same = (a: PlayerRow[], b: PlayerRow[]) => JSON.stringify(brief(a)) === JSON.stringify(brief(b));

// ------------------------------------------------------------------ live test

class ProbeLog {
    constructor(readonly path: string, readonly bot: string, readonly phase: string) {
        mkdirSync(dirname(path), { recursive: true });
    }
    write(event: string, data: Record<string, unknown> = {}): void {
        const line = { at: new Date().toISOString(), bot: this.bot, phase: this.phase, event, ...data };
        appendFileSync(this.path, JSON.stringify(line) + '\n');
        console.log(JSON.stringify(line));
    }
}

function skillLevels(s: BotWorldState): Record<string, number> {
    return Object.fromEntries(s.skills.map(k => [k.name, k.baseLevel]));
}

function skillOf(s: BotWorldState, name: string) {
    return s.skills.find(k => k.name.toLowerCase() === name.toLowerCase());
}

/** Log the first published tick at which each base level rises. */
function watchLevels(session: Session, log: ProbeLog): () => void {
    let prev: Record<string, number> | null = null;
    return session.sdk.onStateUpdate(s => {
        if (!s.inGame || s.skills.length === 0) return;
        const now = skillLevels(s);
        if (prev) {
            for (const [k, v] of Object.entries(now)) {
                if (prev[k] !== undefined && v > prev[k]!) log.write('levelup', { skill: k, from: prev[k], to: v, tick: s.tick, xp: skillOf(s, k)?.experience });
            }
        }
        prev = now;
    });
}

async function snapshot(log: ProbeLog, label: string, tick: number | null): Promise<PlayerRow[]> {
    const rows = present(await fetchPlayer(log.bot));
    log.write('board', { label, tick, rows: brief(rows) });
    return rows;
}

/** Stay in the world for `ticks`, reading the board every `every` ticks and logging any change. */
async function idleWatching(session: Session, log: ProbeLog, ticks: number, every: number): Promise<void> {
    const start = session.sdk.getState()!.tick;
    let last = await snapshot(log, 'idle-start', start);
    while (session.sdk.getState()!.tick < start + ticks) {
        const left = start + ticks - session.sdk.getState()!.tick;
        await waitTicks(session.sdk, Math.min(every, left));
        const tick = session.sdk.getState()!.tick;
        const rows = present(await fetchPlayer(log.bot));
        if (!same(rows, last)) log.write('board-changed-in-world', { tick, rows: brief(rows) });
        last = rows;
    }
    await snapshot(log, 'idle-end', session.sdk.getState()!.tick);
}

async function chopUntil(session: Session, log: ProbeLog, level: number): Promise<void> {
    const { bot, sdk } = session;
    for (let tries = 0; (skillOf(sdk.getState()!, 'Woodcutting')?.baseLevel ?? 1) < level; tries++) {
        if (tries > 60) throw new Error('chopUntil: too many attempts');
        const tree = sdk.findNearbyLoc(/^tree$/i);
        if (!tree) throw new Error('no tree in view');
        const r = await bot.chopTree(tree);
        log.write('chop', { ok: r.success, msg: r.message, tick: sdk.getState()!.tick, wc: skillOf(sdk.getState()!, 'Woodcutting') });
        await bot.dismissBlockingUI();
    }
}

async function burnUntil(session: Session, log: ProbeLog, level: number): Promise<void> {
    const { bot, sdk } = session;
    for (let tries = 0; (skillOf(sdk.getState()!, 'Firemaking')?.baseLevel ?? 1) < level; tries++) {
        if (tries > 30) throw new Error('burnUntil: too many attempts');
        if (!sdk.findInventoryItem(/^logs$/i)) {
            const tree = sdk.findNearbyLoc(/^tree$/i);
            if (!tree) throw new Error('no tree in view');
            await bot.chopTree(tree);
            await bot.dismissBlockingUI();
            continue;
        }
        const r = await bot.burnLogs(/^logs$/i);
        log.write('burn', { ok: r.success, msg: r.message, tick: sdk.getState()!.tick, fm: skillOf(sdk.getState()!, 'Firemaking') });
        await bot.dismissBlockingUI();
        if (!r.success) {
            // Can't light here (a fire or object on the tile): step one tile and retry.
            const p = sdk.getState()!.player!;
            await bot.walkTo(p.worldX + ((tries % 3) - 1), p.worldZ - 1, 0);
        }
    }
}

/** After logout the login server writes the rows; read until they change or `ms` passes. */
async function boardAfterLogout(log: ProbeLog, before: PlayerRow[], ms: number): Promise<void> {
    const t0 = Date.now();
    let rows = before;
    while (Date.now() - t0 < ms) {
        await sleep(3_000);
        rows = present(await fetchPlayer(log.bot));
        if (!same(rows, before)) break;
    }
    log.write('board', { label: 'after-logout', changed: !same(rows, before), waitedMs: Date.now() - t0, rows: brief(rows) });
}

/**
 * A login soon after a logout can be accepted and then dropped before the first
 * tick (session.ts, login); the lite child then exits. Back off and launch again.
 */
async function openWithRetry(botName: string, log: ProbeLog): Promise<Session> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await openSession(botName, { client: 'lite', launch: true, readyTimeoutMs: 60_000 });
        } catch (err) {
            log.write('login-failed', { attempt, error: String(err) });
            if (attempt >= 4) throw err;
            await sleep(20_000 * attempt);
        }
    }
}

async function live(botName: string, phase: string): Promise<void> {
    const log = new ProbeLog(process.env.PROBE_LOG ?? join(ROOT, 'speedrun', 'runs', `hiscore-probe-${botName}.jsonl`), botName, phase);
    const before = present(await fetchPlayer(botName).catch(() => null));
    log.write('board', { label: 'before-login', rows: brief(before) });

    const session = await openWithRetry(botName, log);
    const s0 = session.sdk.getState()!;
    log.write('login', { tick: s0.tick, pos: s0.player && { x: s0.player.worldX, z: s0.player.worldZ }, skills: skillLevels(s0), inv: s0.inventory.map(i => i.name), worn: s0.equipment.map(i => i.name), modal: s0.modalOpen, dialog: s0.dialog.isOpen });
    const stopWatch = watchLevels(session, log);
    try {
        if (s0.modalOpen || s0.dialog.isOpen || session.sdk.findNearbyNpc(/runescape guide/i)) {
            const r = await session.bot.skipTutorial();
            const s = session.sdk.getState()!;
            log.write('tutorial', { ok: r.success, msg: r.message, tick: s.tick, pos: s.player && { x: s.player.worldX, z: s.player.worldZ } });
        }
        if (phase === 'recon') {
            const s = session.sdk.getState()!;
            log.write('recon', { tick: s.tick, trees: s.nearbyLocs.filter(l => /tree/i.test(l.name)).slice(0, 5).map(l => ({ name: l.name, x: l.x, z: l.z })) });
            await waitTicks(session.sdk, 5);
        } else if (phase === 'a') {
            await chopUntil(session, log, 15);
            await idleWatching(session, log, 1550, 100);
        } else if (phase === 'c') {
            const wc = skillOf(session.sdk.getState()!, 'Woodcutting')!.baseLevel;
            await chopUntil(session, log, wc + 1);
            await idleWatching(session, log, 200, 50);
        } else if (phase === 'd') {
            await burnUntil(session, log, 15);
            await idleWatching(session, log, 200, 50);
        } else {
            throw new Error(`unknown phase ${phase}`);
        }
    } finally {
        stopWatch();
        const pre = present(await fetchPlayer(botName).catch(() => null));
        const out = await logoutClean(session);
        log.write('logout', { ...out, skills: skillLevels(session.sdk.getState()!) });
        await closeSession(session);
        await boardAfterLogout(log, pre, 45_000);
    }
}

// ------------------------------------------------------------------ cli

async function main(): Promise<void> {
    const [cmd, ...args] = process.argv.slice(2);
    if (cmd === 'page' || cmd === 'classify') {
        // One request at a time, with a pause: this reads a shared public server.
        for (const [i, p] of args.entries()) {
            if (i > 0) await sleep(Number(process.env.PROBE_DELAY_MS ?? 1_000));
            const rows = await fetchPlayer(p);
            if (cmd === 'page') console.log(JSON.stringify({ player: p, rows }));
            else console.log(rows ? renderAnalysis(p, analyzeAccount(rows)) + '\n' : `### ${p}: not found\n`);
        }
    } else if (cmd === 'live' && args.length === 2) {
        await live(args[0]!, args[1]!);
    } else {
        console.error('usage: hiscore-stamp-probe.ts page|classify <player>... | live <bot> recon|a|c|d');
        process.exit(2);
    }
    process.exit(0);
}

if (import.meta.main) await main();
