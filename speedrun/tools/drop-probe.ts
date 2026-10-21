// Demo drop probe: how many ticks a player stays in the world on
// rs-sdk-demo.fly.dev after its lite client is SIGKILLed mid-world.
//
//   bun speedrun/tools/drop-probe.ts <throwaway-bot>
//   bun speedrun/tools/drop-probe.ts <throwaway-bot> stamp --pA=N --dropTick=N --offset=N
//
// A board row is rewritten only when its level changes, so a timed-out removal
// that changed no level leaves the Overall time where the clean logout put it.
// The `stamp` phase reads the stay anyway: it logs in, chops until Woodcutting
// first levels up (one log at 25x), and logs out. Overall's time is then the
// level-up stamp, the playtime at that tick, so
//   stay = stamp - pA - (dropTick + offset) - (level-up client tick + offset).
//
// Only for a throwaway (refuses the scored account and the fleet's names). It
// does nothing in the world but stand where it logs in, so it meets no one.
// The server-side tick count comes from the board: on an account whose levels
// all have stamp 0, the Overall time is the playtime of its last logout save
// (hiscore-timestamps.md section 1), and a timed-out player is saved on removal
// like a logout. So
//   ticks in the world after the drop = P_after - P_before - offset - (client tick at the drop),
// with the offset taken from a clean session first. /playerpositions (cached
// 1 s server side, polled every 5 s) gives the wall-clock check.

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ROOT, closeSession, logoutClean, openSession, type Session } from '../lib/session';
import { sleep, tickMs, waitTicks } from '../lib/wait';
import { fetchPlayer } from './hiscore-stamp-probe';

const ORIGIN = process.env.HISCORE_ORIGIN ?? 'https://rs-sdk-demo.fly.dev';
const PROTECTED = /^(www_cairn_md|cairn_dot_md|cairn_h\d+|cairn_t\d+|cairn_mule\d|cairn_cam|cairn_md|cairn_amb)$/i;
const MAX_WAIT_TICKS = 5_000;

const bot = process.argv[2];
if (!bot || PROTECTED.test(bot)) {
    console.error(`usage: drop-probe.ts <throwaway-bot> (not the scored account or a fleet name)`);
    process.exit(2);
}
const logPath = join(ROOT, 'speedrun', 'runs', `drop-probe-${bot}.jsonl`);
mkdirSync(join(ROOT, 'speedrun', 'runs'), { recursive: true });
function log(event: string, data: Record<string, unknown> = {}): void {
    const line = JSON.stringify({ at: new Date().toISOString(), bot, event, ...data });
    appendFileSync(logPath, line + '\n');
    console.log(line);
}

function ensureBotEnv(): void {
    const path = join(ROOT, 'bots', bot!, 'bot.env');
    if (existsSync(path)) return;
    mkdirSync(join(ROOT, 'bots', bot!), { recursive: true });
    const password = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
    writeFileSync(path, [`BOT_USERNAME=${bot}`, `PASSWORD=${password}`, 'SERVER=rs-sdk-demo.fly.dev', 'SHOW_CHAT=false', 'TELEMETRY=false', ''].join('\n'));
}

async function overallTicks(): Promise<number | null> {
    const rows = await fetchPlayer(bot!).catch(() => null);
    return rows?.find(r => r.skill === 'Overall')?.ticks ?? null;
}

async function boardChange(from: number | null, ms: number): Promise<number | null> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        const t = await overallTicks();
        if (t !== null && t !== from) return t;
        await sleep(3_000);
    }
    return null;
}

async function onlineNow(): Promise<boolean> {
    const res = await fetch(`${ORIGIN}/playerpositions`);
    const list = (await res.json()) as { name: string }[];
    const n = bot!.toLowerCase().replace(/_/g, ' ');
    return list.some(p => p.name.toLowerCase().replace(/_/g, ' ') === n);
}

async function open(pathfinding = false): Promise<Session> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await openSession(bot!, { launch: true, pathfinding, readyTimeoutMs: 90_000 });
        } catch (err) {
            log('login-failed', { attempt, error: String(err) });
            if (attempt >= 3) throw err;
            await sleep(20_000 * attempt);
        }
    }
}

function num(name: string): number {
    const hit = process.argv.find(a => a.startsWith(`--${name}=`));
    if (!hit) throw new Error(`stamp needs --${name}=N`);
    return Number(hit.slice(name.length + 3));
}

ensureBotEnv();

if (process.argv[3] === 'stamp') {
    const pA = num('pA');
    const dropTick = num('dropTick');
    const offset = num('offset');
    const c = await open(true);
    const wc = () => c.sdk.getState()?.skills.find(k => k.name === 'Woodcutting');
    const startLevel = wc()?.baseLevel ?? 1;
    let levelTick: number | null = null;
    const stop = c.sdk.onStateUpdate(s => {
        const lvl = s.skills.find(k => k.name === 'Woodcutting')?.baseLevel ?? 1;
        if (levelTick === null && s.inGame && lvl > startLevel) levelTick = s.tick;
    });
    for (let tries = 0; levelTick === null; tries++) {
        if (tries > 20) throw new Error('stamp: no Woodcutting level-up');
        const tree = c.sdk.findNearbyLoc(/^tree$/i);
        if (!tree) throw new Error('stamp: no tree in view');
        const r = await c.bot.chopTree(tree);
        log('chop', { ok: r.success, msg: r.message, tick: c.sdk.getState()?.tick });
        await c.bot.dismissBlockingUI();
    }
    stop();
    const out = await logoutClean(c);
    await closeSession(c);
    const stamp = await boardChange(pA, 120_000);
    log('stamp', {
        levelTick,
        stamp,
        logout: out,
        ticksInWorldAfterDrop: stamp === null ? null : stamp - pA - (dropTick + offset) - (levelTick! + offset),
    });
    process.exit(0);
}

log('start', { tickMs: tickMs() });

// A: a clean session, for P_before and the client-tick to playtime offset.
const before = await overallTicks();
const a = await open();
const s0 = a.sdk.getState()!;
if (s0.modalOpen || s0.dialog.isOpen || a.sdk.findNearbyNpc(/runescape guide/i)) {
    const r = await a.bot.skipTutorial();
    log('tutorial', { ok: r.success, msg: r.message });
}
await waitTicks(a.sdk, 10);
const outA = await logoutClean(a);
await closeSession(a);
const pA = await boardChange(before, 90_000);
const offset = pA === null ? null : pA - (before ?? 0) - outA.lastInWorldTick;
log('baseline', { before, pA, clickTick: outA.clickTick, lastInWorldTick: outA.lastInWorldTick, ok: outA.ok, offset });
if (pA === null || offset === null) throw new Error('baseline: the board did not update after the clean logout');
await sleep(30_000); // let the logout save settle before the next login

// B: log in, play 20 ticks, SIGKILL the client.
const b = await open();
await waitTicks(b.sdk, 20);
const dropTick = b.lastInWorldTick;
const dropAt = Date.now();
b.child!.kill('SIGKILL');
await b.child!.exited;
await closeSession(b);
log('drop', { dropTick });

let goneAt: number | null = null;
while (Date.now() - dropAt < MAX_WAIT_TICKS * tickMs()) {
    if (!(await onlineNow())) {
        goneAt = Date.now();
        break;
    }
    await sleep(5_000);
}
const wallTicks = Math.round(((goneAt ?? Date.now()) - dropAt) / tickMs());
if (goneAt === null) {
    log('still-online', { wallTicks });
    // Take the session over and leave cleanly.
    const c = await open();
    const outC = await logoutClean(c);
    await closeSession(c);
    log('cleanup-logout', { ...outC });
    process.exit(1);
}
const pB = await boardChange(pA, 120_000);
log('result', {
    dropTick,
    pA,
    pB,
    offset,
    ticksInWorldAfterDrop: pB === null ? null : pB - pA - offset - dropTick,
    wallTicksUntilGoneFromPlayerpositions: wallTicks,
});
process.exit(0);
