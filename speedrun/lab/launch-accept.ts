// Lab acceptance for rs/668: a browser launch is accepted only on its own launch id, and a failed
// start ends in a confirmed logout through the page. Lab accounts only, on the browser client over
// the run's page path (proxy.ts in front of the lab world, the tab logged in by a one-time token over
// CDP, as drop-accept.ts), against the lab's unmodified gateway. One scenario per process:
//
//   (cd server/webclient && bun run build)
//   NODE_TICKRATE=400 SPEEDRUN_TICK_MS=400 LAB_RUNNERS=0 LAB_TIMEOUT=1800 \
//     speedrun/lab/lab.sh <lab bot> speedrun/lab/launch-accept.ts:accept speedrun/lab/launch-accept.ts:cached speedrun/lab/launch-accept.ts:throw
//
//   accept  a normal launch: the page echoes the launch id and openSession takes it; then a clean logout.
//   cached  attempt 3's 04:2xZ start. A lite one-off logs in and out, so the gateway holds its last
//           state. Then the browser launch, whose page's game socket is dropped (drop-accept's 'title'
//           shape: its own reconnect swallowed) the moment it is in game. Expected: a refusal with the
//           page's reason, one takeover login in page, the logout click, and the account confirmed
//           out by the page and /playerpositions.
//   throw   a startup throw after a real page login, inside run.ts's withScoredSession: a confirmed
//           logout and the run log's abandon row.
//
// One RESULT line each: pass, the host, the bundle's sha256 and the git head, and the page's
// transitions read over DevTools every 100 ms. For `cached`, `refusalToTakeoverTicks` is wall time over
// tickMs() from the refusal to the page back in game on the takeover login. The refusal is timed by
// the rule that made it: 'login ended' PAGE_ENDED_HOLD_MS after the page was first read out, 'none of
// its states reached our gateway' GATEWAY_BACK_GRACE_TICKS after it was first read in game. On the
// real client the second fires first: a page whose game socket is closed keeps `ingame` true until
// its own read times out (about 15 s on fedora at 400 ms), and publishes nothing meanwhile.

import { createHash } from 'crypto';
import { mkdtempSync, readFileSync } from 'fs';
import { hostname, tmpdir } from 'os';
import { join } from 'path';
import { demoOrigin, listedInWorld } from '../lib/demo-status';
import { cdpUrl, closeSession, GATEWAY_BACK_GRACE_TICKS, loadBotEnv, logoutClean, openSession, PAGE_ENDED_HOLD_MS, ROOT, type Session } from '../lib/session';
import { evaluateInTab, pageLaunchState } from '../lib/tab';
import { newRunId, TickLog } from '../lib/ticks';
import { tickMs } from '../lib/wait';
import { withScoredSession } from '../run';
import { RelogBudget } from '../runner/relog-budget';
import { launchLabBrowser } from './browser';

/**
 * drop-accept.ts's 'title' drop (that file is a script, so it is not imported): the page's game socket
 * closed with its one reconnect attempt swallowed, so it falls to the title screen while its body
 * stays in the world.
 */
const DROP_TITLE = `(() => {
    const c = window.gameClient;
    if (!c || !c.ingame) return 'not in game';
    if (!c.stream) return 'no stream';
    c.login = async function () { delete c.login; };
    c.stream.close();
    return 'dropped';
})()`;

const bot = process.argv[2];
const scenario = process.argv[3];
const SCENARIOS = ['accept', 'cached', 'throw'] as const;
if (!bot || !SCENARIOS.includes(scenario as never)) {
    console.error(`usage: bun speedrun/lab/launch-accept.ts <lab bot> ${SCENARIOS.join('|')}`);
    process.exit(2);
}

const webPort = process.env.WEB_PORT ?? '9300';
const agentPort = process.env.AGENT_PORT ?? '8300';
const cdpPort = Number(webPort) + 5;
const pagePort = Number(webPort) + 6;
const base = mkdtempSync(join(tmpdir(), `launch-accept-${scenario}-`));
const world = demoOrigin(`localhost:${webPort}`);
const t0 = Date.now();
const at = (ms: number | null) => (ms === null ? null : ms - t0);

const bundlePath = join(ROOT, 'server', 'webclient', 'out', 'bot', 'client.js');
const bundle = (() => {
    try {
        return createHash('sha256').update(readFileSync(bundlePath)).digest('hex');
    } catch {
        return null;
    }
})();
const head = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: ROOT }).stdout.toString().trim();

const proxy = Bun.spawn(['bun', 'proxy.ts', `--world=http://localhost:${webPort}`, `--port=${pagePort}`, `--gateway=ws://localhost:${agentPort}`, `--bots-dir=${join(ROOT, 'bots')}`], {
    cwd: join(ROOT, 'server', 'webclient'),
    stdout: Bun.file(join(base, 'proxy.log')),
    stderr: Bun.file(join(base, 'proxy.err')),
});
for (let k = 0; k < 100; k++) {
    if (await fetch(`http://127.0.0.1:${pagePort}/bot?bot=x`, { redirect: 'manual' }).then(() => true, () => false)) break;
    await Bun.sleep(100);
}

/** The page's login flags over DevTools every 100 ms, as transitions (changes only), until stopped. */
function watchPage(cdp: string, onChange: (p: { inGame: boolean; loginInProgress: boolean; launch: string | null; message: string }, ms: number) => void) {
    let stop = false;
    let last = '';
    const done = (async () => {
        while (!stop) {
            const p = await pageLaunchState(cdp, account).catch(() => null);
            if (p?.hasClient) {
                const line = JSON.stringify([p.launch, p.inGame, p.loginInProgress, p.message]);
                if (line !== last) onChange(p, Date.now());
                last = line;
            }
            await Bun.sleep(100);
        }
    })();
    return async () => {
        stop = true;
        await done;
    };
}

const browser = await launchLabBrowser(bot, { cdpPort, clientUrl: `http://127.0.0.1:${pagePort}/bot?server=localhost:${webPort}&gateway=ws://localhost:${agentPort}` });
const account = loadBotEnv(bot).BOT_USERNAME;
const cdp = cdpUrl({ BOT_USERNAME: account, PASSWORD: '' })!;
let session: Session | null = null;
let pass = false;
const out: Record<string, unknown> = { scenario, host: hostname(), tickMs: tickMs(), bundle, bundlePath, head, gateway: 'unmodified (lab.sh)', files: base };
try {
    if (scenario === 'accept') {
        const s = await openSession(bot, { client: 'browser', launch: true });
        session = s;
        const st = s.sdk.getState();
        const logout = await logoutClean(s);
        const listed = await listedInWorld(world, s.env.BOT_USERNAME);
        Object.assign(out, { launchTag: s.launchTag, stateLaunch: st?.launch ?? null, tick: st?.tick ?? null, openMs: Date.now() - t0, logout, listedAfter: listed });
        pass = !!s.launchTag && st?.launch === s.launchTag && logout.ok && listed === false;
    } else if (scenario === 'cached') {
        // The lite one-off: in, then out, so the gateway keeps its last state with no client behind it.
        const lite = await openSession(bot, { client: 'lite', launch: true });
        const liteLogout = await logoutClean(lite);
        await closeSession(lite);
        await Bun.sleep(1_000);
        const cachedStatus = await fetch(`http://127.0.0.1:${agentPort}/status/${encodeURIComponent(lite.env.BOT_USERNAME)}`).then(r => r.json(), () => null);
        const cachedState = await fetch(`http://127.0.0.1:${agentPort}/state/${encodeURIComponent(lite.env.BOT_USERNAME)}`).then(r => r.json(), () => null) as { state?: { tick?: number; inGame?: boolean; launch?: string } } | null;
        console.log(`[cached] the lite one-off out (${liteLogout.ok ? 'confirmed' : liteLogout.reason}); the gateway holds tick ${cachedState?.state?.tick} inGame ${cachedState?.state?.inGame}`);

        const marks = { dropAt: null as number | null, dropAnswer: null as string | null, outAt: null as number | null, gateAt: null as number | null, takeoverInAt: null as number | null, loggedOutAt: null as number | null };
        const transitions: unknown[] = [];
        const stopWatch = watchPage(cdp, (p, ms) => {
            transitions.push({ ms: at(ms), launch: p.launch, inGame: p.inGame, loginInProgress: p.loginInProgress, message: p.message });
            if (p.inGame && marks.dropAt === null) {
                marks.dropAt = ms;
                void evaluateInTab<string>(cdp, account, DROP_TITLE).then(r => (marks.dropAnswer = r?.value ?? 'no tab'), e => (marks.dropAnswer = `threw ${e}`));
            } else if (!p.inGame && !p.loginInProgress && marks.dropAt !== null && marks.outAt === null) marks.outAt = ms;
            else if (p.inGame && marks.gateAt !== null && marks.takeoverInAt === null) marks.takeoverInAt = ms;
            else if (!p.inGame && marks.takeoverInAt !== null && marks.loggedOutAt === null) marks.loggedOutAt = ms;
        });
        const err = await openSession(bot, {
            client: 'browser',
            launch: true,
            takeover: async () => {
                marks.gateAt = Date.now();
                return () => {};
            },
        }).then(
            s => ((session = s), new Error('the launch was accepted')),
            (e: Error) => e
        );
        const rejectAt = Date.now();
        await stopWatch();
        const listed = await listedInWorld(world, account);
        const rule = /none of its states reached our gateway/.test(err.message) ? 'silent' : /login ended/.test(err.message) ? 'ended' : null;
        const refusedAt =
            rule === 'silent' && marks.dropAt !== null ? marks.dropAt + GATEWAY_BACK_GRACE_TICKS * tickMs() : rule === 'ended' && marks.outAt !== null ? marks.outAt + PAGE_ENDED_HOLD_MS : null;
        Object.assign(out, {
            liteLogout, cachedStatus, cachedState: cachedState?.state ? { tick: cachedState.state.tick, inGame: cachedState.state.inGame, launch: cachedState.state.launch ?? null } : null,
            error: err.message, refusalRule: rule, marks: Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, typeof v === 'number' ? at(v) : v])), refusedAt: at(refusedAt), rejectAt: at(rejectAt),
            refusalToTakeoverTicks: refusedAt !== null && marks.takeoverInAt !== null ? Math.round((marks.takeoverInAt - refusedAt) / tickMs()) : null,
            refusalToConfirmedOutTicks: refusedAt !== null ? Math.round((rejectAt - refusedAt) / tickMs()) : null,
            transitions, listedAfter: listed,
        });
        // Refused on the page's own evidence (either page rule), then confirmed out by the page and the world.
        pass = rule !== null && /refusing launch \w+: /.test(err.message) && /logged out, confirmed/.test(err.message) && listed === false;
    } else {
        const s = await openSession(bot, { client: 'browser', launch: true });
        session = s;
        const log = TickLog.open(`launch-${newRunId()}`, join(base, 'run.jsonl'));
        const relogs = new RelogBudget(join(base, 'run-dir'));
        const err = await withScoredSession(s, { relogs, log }, async () => {
            throw new Error('lab: a startup throw after the page login');
        }).then(() => null, (e: Error) => e);
        session = null; // withScoredSession closed it
        const listed = await listedInWorld(world, s.env.BOT_USERNAME);
        const row = log.rows.find(r => r.step.startsWith('(run) SCORED abandoned'));
        Object.assign(out, { launchTag: s.launchTag, error: err?.message ?? null, abandonRow: row ? { step: row.step, ok: row.ok, meta: row.meta } : null, relogs: relogs.entries(), listedAfter: listed });
        pass = err?.message === 'lab: a startup throw after the page login' && row?.ok === true && listed === false;
    }
} catch (e) {
    out.threw = e instanceof Error ? e.stack : String(e);
    console.error(`[launch-accept] ${out.threw}`);
} finally {
    if (session) await closeSession(session).catch(() => {});
    await browser.kill().catch(() => {});
    proxy.kill('SIGTERM');
}
console.log(`RESULT launch-accept ${JSON.stringify({ pass, ...out })}`);
process.exit(pass ? 0 : 1);
