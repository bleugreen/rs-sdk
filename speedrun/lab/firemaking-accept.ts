// Lab acceptance for the Firemaking step module (speedrun/skills/firemaking.ts, STEP-MANIFEST.md
// entry 16): S03 run through runSteps from S03's real start, against the real log supply.
//
//   row:   the H6 log-row dropper (speedrun/helpers/fm-row.ts, restock `cheat`) drops the route's
//          157 logs on the H6 lab snake. It starts on a cue file, as the run machine starts it
//          (fm-row.md "Starting"), and SCORED's step begins when log 0 is due, so the step's ticks
//          are S03's own and hold no private-window wait.
//   trade: a lab giver (this script, --role=giver: lib/trade.ts give with a standing request)
//          stands on each refill's giver tile with its package, both from firemaking.ts tradePlan,
//          restocked by ::give. SCORED refills through the module's own receiveFrom.
//
//   NODE_TICKRATE=300 LAB_HELPERS=fmdrp1 WEB_PORT=9640 WEB_MANAGEMENT_PORT=9641 HISCORES_WEB_PORT=9642 NODE_PORT=44340 AGENT_PORT=8640 \
//     speedrun/lab/lab.sh fmacc1 speedrun/lab/firemaking-accept.ts:--supply=row:--helper=fmdrp1
//   NODE_TICKRATE=300 LAB_HELPERS=fmgiv1 (same ports) speedrun/lab/lab.sh fmacc2 speedrun/lab/firemaking-accept.ts:--supply=trade:--helper=fmgiv1
//
// Options: --supply=row|trade, --helper=<dropper or giver>, --row=3019,3362,27 --rows=2 (fm-row.ts
//   LAB_ROW, the confirmed Falador east snake: 54 tiles a lap), --to=99, --lead=4, --capacity=N
//   (trade; default the module's: 28 less the non-log items held), --out=<dir>,
//   --approach=N: SCORED first walks N tiles east of the entry, and the step starts there, so the
//     time to the first light is the entry approach (RESULT `approach`, with the distance reached).
//
// S03's real start (RUN-ORDER.md S00-S02): the starter junk went in T01-02, so SCORED holds the
// tinderbox, the five starter rune types and H1's cosmic and fire runes, wields H1's staff of water,
// and has Magic 7 from S02. Firemaking 1. The run walks from the coop to the row; here SCORED is
// teleported to the row's entry, which is travel, not S03.
//
// The 54-log row (entry 16's "a 54-log dropped row, 4.00 ticks per fire") is one lap of the snake.
// RESULT reports every lap: lap 1 (logs 0-53) carries the failed rolls below level 43, so the
// chain's own pace is lap 2 (logs 54-107, every roll certain, no lap turn inside it).

import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runScript } from '../../sdk/runner';
import { closeSession, openSession, type Session } from '../lib/session';
import type { BotWorldState } from '../../sdk/types';
import { GO_FILE, LAB_ROW, snakeTile } from '../helpers/fm-row';
import { TickLog, newRunId } from '../lib/ticks';
import { give as tradeGive } from '../lib/trade';
import { tickMs, waitUntil } from '../lib/wait';
import { runSteps } from '../runner/step';
import { defaultCapacity, DEFAULT_ID, steps, tradePlan, type Tile } from '../skills/firemaking';
import { launchLabBrowser } from './browser';
import { arg, botArg, result } from './common';
import { labCueDropperOptions } from './fm-row-launch';
import { cheat, clearInventory, give, leaveTutorial, mustTele, setstat } from './setup';

const ROOT = resolve(import.meta.dir, '..', '..');
// runScript copies the running bot's bot.env into process.env (sdk/runner.ts), and a helper that
// inherited it would log in as SCORED and take over its gateway session. Helpers get this snapshot.
const HELPER_ENV: Record<string, string | undefined> = { ...process.env };
const me = botArg();
const role = arg('role', 'scored');
const supply = arg('supply', 'row') as 'row' | 'trade';
if (supply !== 'row' && supply !== 'trade') throw new Error('--supply must be row or trade');
const helper = arg('helper', supply === 'row' ? 'fmdrp1' : 'fmgiv1');
const [rx, rz, rlen] = arg('row', `${LAB_ROW.x},${LAB_ROW.z},${LAB_ROW.len}`).split(',').map(Number) as [number, number, number];
const row = { x: rx, z: rz, len: rlen, rows: Number(arg('rows', String(LAB_ROW.rows))) };
const toLevel = Number(arg('to', '99'));
const lead = Number(arg('lead', '4'));
const capacityArg = arg('capacity', '');
const approach = Number(arg('approach', '0'));
const client = arg('client', 'lite');
if (client !== 'lite' && client !== 'browser') throw new Error('--client must be lite or browser');
const arrive = arg('arrive', 'tele');
if (arrive !== 'tele' && arrive !== 'walk') throw new Error('--arrive must be tele or walk');
const LAP = row.len * row.rows;
const tiles: Tile[] = Array.from({ length: LAP }, (_, i) => {
    const t = snakeTile(row, i);
    return [t.x, t.z] as const;
});
const ms = tickMs();

/** H1's runes and the starter rune types: SCORED's rune stacks at S03 (counts are immaterial here). */
const S03_RUNES = ['airrune', 'mindrune', 'waterrune', 'earthrune', 'bodyrune', 'cosmicrune', 'firerune'];

const emit = (o: Record<string, unknown>) => console.log(JSON.stringify({ role, ...o }));
const at = (s: BotWorldState | null, t: Tile) => s?.player?.worldX === t[0] && s?.player?.worldZ === t[1];

/** Off Tutorial Island through S00's tutorialSkip (every side tab open), then any open dialog dismissed. */
async function outOfTutorial(actions: Session['bot'], sdk: Session['sdk']) {
    await leaveTutorial({ sdk, bot: actions, name: me, sessionId: 0 });
    while (sdk.getState()?.dialog.isOpen) {
        await sdk.sendClickDialog(0);
        await sdk.waitForTicks(1);
    }
}

// ------------------------------------------------------------------ the lab giver (trade)

if (role === 'giver') {
    const partner = arg('partner', '');
    const capacity = Number(capacityArg);
    if (!partner || !Number.isInteger(capacity)) throw new Error('giver: --partner and --capacity are required');
    await runScript(async ({ bot: actions, sdk }) => {
        await outOfTutorial(actions, sdk);
        for (const r of tradePlan(0, toLevel, capacity, tiles)) {
            await clearInventory(sdk);
            for (const p of r.package) await cheat(sdk, `give ${p.obj} ${p.n}`);
            const want = r.logs;
            const loaded = await waitUntil(sdk, s => s.inventory.filter(i => r.package.some(p => p.name.toLowerCase() === i.name.toLowerCase())).reduce((a, i) => a + i.count, 0) >= want, { maxTicks: 10 });
            if (!loaded.ok) throw new Error(`giver: package ${r.k} not loaded`);
            const g = r.giverTile!;
            if (!at(sdk.getState(), g)) {
                await sdk.sendWalk(g[0], g[1], true);
                if (!(await waitUntil(sdk, s => at(s, g), { maxTicks: 30 })).ok) await mustTele(sdk, g[0], g[1]);
            }
            emit({ message: 'ready', k: r.k, tile: g, logs: r.logs, tick: sdk.getState()!.tick, ms: Date.now() });
            for (let attempt = 0; ; attempt++) {
                // tradePlan's protocol: request as SCORED's last held log rolls, when SCORED is beside this
                // tile. A request is a player op, so one sent while SCORED is further off walks this giver
                // off its tile towards SCORED, and SCORED's own trade click then chases it down the row.
                await waitUntil(sdk, s => s.nearbyPlayers.some(p => p.name.toLowerCase() === partner.toLowerCase() && Math.max(Math.abs(p.x - g[0]), Math.abs(p.z - g[1])) <= 2), { maxTicks: 2000 });
                const res = await tradeGive(sdk, partner, r.package.map(p => ({ item: new RegExp(`^${p.name}$`, 'i'), n: p.n })), { openTimeoutMs: 30 * 60_000, maxTicks: 100 });
                emit({ message: 'gave', k: r.k, ok: res.ok, ticks: res.ticks, attempt, ...(res.reason ? { reason: res.reason } : {}), ms: Date.now() });
                if (res.ok) break;
                if (attempt >= 3 && res.reason !== 'player_not_found') throw new Error(`giver: refill ${r.k} failed ${attempt + 1} times`);
            }
        }
        emit({ message: 'finished' });
    }, { timeout: 0, printState: false });
    process.exit(0);
}

// ------------------------------------------------------------------ the helper process

const base = arg('out', '') || mkdtempSync(join(tmpdir(), `fm-accept-${supply}-`));
// An --out directory must exist before the helper log and the browser proxy's log files open in it.
mkdirSync(base, { recursive: true });
interface Line { message?: string; phase?: string; i?: number; k?: number; tick?: number; ms?: number; need?: number; early?: boolean; ok?: boolean; [k: string]: unknown }
const lines: Line[] = [];
const waiters: Array<{ pred: (l: Line) => boolean; res: (l: Line) => void }> = [];
const nextLine = (pred: (l: Line) => boolean, timeoutMs: number) => {
    const hit = lines.find(pred);
    if (hit) return Promise.resolve(hit);
    return Promise.race([new Promise<Line>(res => waiters.push({ pred, res })), Bun.sleep(timeoutMs).then(() => null)]);
};

function spawnHelper(argv: string[], env: Record<string, string> = {}) {
    const p = Bun.spawn([process.execPath, ...argv], { cwd: ROOT, env: { ...HELPER_ENV, ...env }, stdout: 'pipe', stderr: 'inherit' });
    void (async () => {
        const dec = new TextDecoder();
        let buf = '';
        const reader = p.stdout.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
                const text = buf.slice(0, i).trim();
                if (!text.startsWith('{')) continue;
                let l: Line;
                try {
                    l = JSON.parse(text) as Line;
                } catch {
                    continue;
                }
                lines.push(l);
                appendFileSync(join(base, `${helper}.jsonl`), text + '\n');
                if (l.message !== 'drop') console.log(`${helper} ${text}`);
                for (const w of waiters.splice(0)) (w.pred(l) ? w.res(l) : waiters.push(w));
            }
        }
    })();
    return p;
}

// ------------------------------------------------------------------ SCORED

async function scoredRun(actions: Session['bot'], sdk: Session['sdk']): Promise<void> {
    await outOfTutorial(actions, sdk);
    await clearInventory(sdk);
    await give(sdk, 'tinderbox');
    for (const r of S03_RUNES) await give(sdk, r, 200);
    await give(sdk, 'staff_of_water');
    await waitUntil(sdk, s => s.inventory.some(i => /staff of water/i.test(i.name)), { maxTicks: 10 });
    await actions.equipItem(/staff of water/i);
    await setstat(sdk, 'magic', 7);
    if (arrive === 'walk') {
        // Arrive by walking from the spawn, so the row's region loads on arrival (the browser runs).
        const start: Tile = [tiles[0]![0] + approach, tiles[0]![1]];
        // A 200-tile walk can stop short (two of three browser trade runs at 6 tries, tolerance 0):
        // walk to within a tile, then step on.
        const near = () => { const p = sdk.getState()?.player; return !!p && Math.max(Math.abs(p.worldX - start[0]), Math.abs(p.worldZ - start[1])) <= 1; };
        for (let k = 0; k < 12 && !near(); k++) await actions.walkTo(start[0], start[1], 1);
        if (near() && !at(sdk.getState(), start)) {
            await sdk.sendWalk(start[0], start[1], true);
            await waitUntil(sdk, s => at(s, start), { maxTicks: 6 });
        }
        if (!at(sdk.getState(), start)) throw new Error(`could not walk to ${start.join(',')}`);
    } else await mustTele(sdk, tiles[0]![0], tiles[0]![1]);
    // The entry approach: the step starts this far from the entry (before the dropper is cued).
    if (approach > 0 && arrive === 'tele') {
        const away: Tile = [tiles[0]![0] + approach, tiles[0]![1]];
        await sdk.sendWalk(away[0], away[1], true);
        await waitUntil(sdk, s => at(s, away), { maxTicks: approach + 10 });
    }
    const s0 = (await waitUntil(sdk, s => s.inventory.length === 1 + S03_RUNES.length && !s.inventory.some(i => /staff/i.test(i.name)), { maxTicks: 20 })).state ?? sdk.getState()!;
    const fm = s0.skills.find(k => k.name.toLowerCase() === 'firemaking');
    if (fm?.baseLevel !== 1 || fm.experience !== 0) throw new Error(`S03 start: Firemaking must be 1 with 0 xp (a used lab account?), got level ${fm?.baseLevel} xp ${fm?.experience}`);
    const inventory = s0.inventory.map(i => `${i.name} x${i.count}`);
    if (s0.inventory.length !== 1 + S03_RUNES.length) throw new Error(`S03 start: expected the tinderbox and ${S03_RUNES.length} rune stacks, got ${inventory.join(', ')}`);
    const capacity = capacityArg ? Number(capacityArg) : defaultCapacity(s0.inventory);
    console.log(`firemaking-accept ${supply}: SCORED stand-in ${me}, helper ${helper}, snake ${row.x},${row.z} x${row.len} x${row.rows}; inventory ${inventory.join(', ')}; files in ${base}`);

    let helperProc: ReturnType<typeof spawnHelper>;
    const setup: Record<string, unknown> = { client, arrive, inventory, capacity: supply === 'trade' ? capacity : undefined };
    if (supply === 'row') {
        helperProc = spawnHelper(['speedrun/helpers/fm-row.ts', helper], {
            ROLE_OPTIONS: JSON.stringify(labCueDropperOptions({ row }, { cueDir: base, lead })),
            HELPER_LAB_TELE: '1'
        });
        if (!(await nextLine(l => l.message === 'phase' && l.phase === 'armed', 240_000))) throw new Error('dropper never armed');
        const cueMs = Date.now();
        writeFileSync(join(base, GO_FILE), JSON.stringify({ v: 1, ms: cueMs }));
        const d0 = await nextLine(l => l.message === 'drop' && l.i === 0, 300_000);
        if (!d0 || typeof d0.ms !== 'number' || typeof d0.tick !== 'number' || typeof d0.need !== 'number') throw new Error('no drop of log 0');
        // SCORED reaches the row when log 0 is due: the dropper's need for it, on the wall clock.
        const dueMs = d0.ms + (d0.need - d0.tick) * ms;
        Object.assign(setup, { cueMs, drop0: { tick: d0.tick, need: d0.need, ms: d0.ms }, startDelayMs: dueMs - cueMs });
        await Bun.sleep(Math.max(0, dueMs - Date.now()));
    } else {
        helperProc = spawnHelper([import.meta.path, helper, '--role=giver', `--partner=${me}`, `--capacity=${capacity}`, `--to=${toLevel}`, `--row=${row.x},${row.z},${row.len}`, `--rows=${row.rows}`]);
        if (!(await nextLine(l => l.message === 'ready' && l.k === 0, 240_000))) throw new Error('giver never ready');
    }

    // Clicked movement goes 2 tiles a tick with the run toggle off or on (rs/280), so it is not set.
    const entry = tiles[0]!;
    const sp = sdk.getState()!.player!;
    setup.approachTiles = Math.max(Math.abs(sp.worldX - entry[0]), Math.abs(sp.worldZ - entry[1]));

    sdk.onStateUpdate(s => {
        const p = s.player;
        if (p) appendFileSync(join(base, 'trace.jsonl'), JSON.stringify({ t: s.tick, ms: Date.now(), x: p.worldX, z: p.worldZ, anim: p.animId, inv: s.inventory.length, msg: s.gameMessages.slice(-2).map(m => m.text) }) + '\n');
    });
    const log = TickLog.open(`lab-fm-accept-${supply}-${newRunId()}`, join(base, 'ticks.jsonl'));
    const session = { sdk, bot: actions, name: me, sessionId: 0 };
    const all = steps({ supply, tiles, toLevel, ...(supply === 'trade' ? { giver: helper, capacity } : {}) });
    let ended = 'done';
    const t0 = sdk.getState()!.tick;
    await runSteps(session as never, all, { log, c: {}, shouldStop: () => false }).catch(e => (ended = e instanceof Error ? e.message : String(e)));
    const t1 = sdk.getState()!.tick;
    helperProc.kill('SIGTERM');
    await Promise.race([helperProc.exited, Bun.sleep(20_000)]);

    // ---------------------------------------------------------------- analysis
    type Fire = { n: number; tick: number; gap: number | null; failures: number; level: number; tier: string; slip: number; fresh: boolean };
    const fires = log.rows.filter(r => r.step === `${DEFAULT_ID} fire`).map(r => r.meta as unknown as Fire).sort((a, b) => a.n - b.n);
    const hist = (xs: number[]) => xs.reduce<Record<number, number>>((h, v) => ((h[v] = (h[v] ?? 0) + 1), h), {});
    const lap = (a: number, b: number) => {
        const fa = fires.find(f => f.n === a);
        const fb = fires.find(f => f.n === Math.min(b, fires.length - 1));
        if (!fa || !fb || fb.n <= a) return null;
        const inner = fires.filter(f => f.n > a && f.n <= fb.n);
        return { logs: `${a}-${fb.n}`, gaps: fb.n - a, ticks: fb.tick - fa.tick, perFire: +((fb.tick - fa.tick) / (fb.n - a)).toFixed(3), failures: inner.reduce((x, f) => x + f.failures, 0), gapHist: hist(inner.map(f => f.gap ?? 0)), levels: `${fa.level}-${fb.level}` };
    };
    const laps = Array.from({ length: Math.ceil(fires.length / LAP) }, (_, k) => lap(k * LAP, (k + 1) * LAP - 1));
    const stepRow = log.rows.find(r => r.step === DEFAULT_ID && r.kind !== 'program');
    const summary = log.rows.find(r => r.step === `${DEFAULT_ID} summary`)?.meta;
    const refills = log.rows.filter(r => r.step === `${DEFAULT_ID} refill`).map(r => ({ ...(r.meta as Record<string, unknown>), startTick: r.startTick, ticks: r.ticks }));
    const drops = lines.filter(l => l.message === 'drop');
    const firstToLast = fires.length > 1 ? fires.at(-1)!.tick - fires[0]!.tick : null;
    const target = supply === 'row' ? 650 : 695;
    const stepTicks = stepRow?.ticks ?? t1 - t0;
    result('firemaking-accept', {
        supply, ended, setup,
        stepTicks, runStepsTicks: t1 - t0, target, vsTarget: `${(((stepTicks - target) / target) * 100).toFixed(1)}%`,
        fires: fires.length, failures: fires.reduce((x, f) => x + f.failures, 0), firstToLast,
        gapHist: hist(fires.filter(f => f.gap !== null).map(f => f.gap!)),
        approach: { tiles: setup.approachTiles, toFirstAttempt: (summary as Record<string, unknown> | undefined)?.fixedTicks ?? null, toFirstFire: fires[0] ? fires[0].tick - t0 : null },
        laps,
        ...(supply === 'row'
            ? { dropped: drops.length, lost: lines.filter(l => l.message === 'lost').length, early: drops.filter(d => d.early).length }
            : { refills: refills.length, refillTicks: refills.map(r => r.ticks), giver: lines.filter(l => l.message === 'gave').map(l => ({ k: l.k, ok: l.ok, ticks: l.ticks, attempt: l.attempt })) }),
        summary,
        files: base
    });
    if (ended !== 'done') process.exitCode = 1;
}

if (client === 'browser') {
    // The run's page path (RUN-HOST.md step 3, as measure-relog.ts): the page server (proxy.ts) in front
    // of the lab world, the tab logged in by a one-time token over CDP. The port block's spares take
    // Chrome's DevTools (WEB_PORT + 5) and the page (WEB_PORT + 6). lab.sh runs with LAB_RUNNERS=0.
    const webPort = process.env.WEB_PORT ?? '9300';
    const agentPort = process.env.AGENT_PORT ?? '8300';
    const cdpPort = Number(webPort) + 5;
    const pagePort = Number(webPort) + 6;
    const proxy = Bun.spawn(['bun', 'proxy.ts', `--world=http://localhost:${webPort}`, `--port=${pagePort}`, `--gateway=ws://localhost:${agentPort}`, `--bots-dir=${join(ROOT, 'bots')}`], {
        cwd: join(ROOT, 'server', 'webclient'),
        stdout: Bun.file(join(base, 'proxy.log')),
        stderr: Bun.file(join(base, 'proxy.err'))
    });
    for (let k = 0; k < 50; k++) {
        if (await fetch(`http://127.0.0.1:${pagePort}/bot?bot=x`, { redirect: 'manual' }).then(() => true, () => false)) break;
        await Bun.sleep(200);
    }
    const browser = await launchLabBrowser(me, { cdpPort, clientUrl: `http://127.0.0.1:${pagePort}/bot?server=localhost:${webPort}&gateway=ws://localhost:${agentPort}` });
    let session: Session | null = null;
    try {
        session = await openSession(me, { client: 'browser', launch: true });
        await scoredRun(session.bot, session.sdk);
    } finally {
        if (session) await closeSession(session).catch(() => {});
        await browser.kill().catch(() => {});
        proxy.kill('SIGTERM');
    }
} else await runScript(async ({ bot, sdk }) => scoredRun(bot, sdk), { timeout: 0, printState: false });
