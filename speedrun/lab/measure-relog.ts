// Relogs through a real Chrome tab on the lab engine (rs/174): the navigating relog against the
// in-page one, with the page's own timeline and the first action's tick.
//
//   (cd server/webclient && bun run build)    # the bundle proxy.ts serves
//   LAB_RUNNERS=0 bash speedrun/lab/lab.sh srrelog speedrun/lab/measure-relog.ts[:--n=3][:--headful]
//
// It starts what the run host has in front of the demo, here in front of the lab world: proxy.ts
// (the page server with one-time login tokens) on 9398, and Chrome with a DevTools port on 9397
// and background throttling off. It points the bot's bot.env at them (CLIENT_URL, CDP_URL), logs
// it in once through the tab, skips the tutorial if needed, teleports it to Varrock west bank and
// logs it out, then runs speedrun/tools/relog-probe.ts --via=navigate,page --bank, which writes
// $LAB_LOG/relog-<bot>.json. Chrome and the page server stop when it ends.
//
// --restart instead measures the relog after a server restart (RUN-ORDER R7): with the tab in the
// world it SIGKILLs the engine (the way the demo dies, no shutdown save), starts a replacement,
// and gets back in through reconnect.ts reconnectAfterOutage with login({ inPage: true }), so it
// shows whether a page whose game socket died logs itself back in or falls back to the navigation.

import { chmodSync, existsSync, openSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import puppeteer from 'puppeteer';
import type { Subprocess } from 'bun';
import { reconnectAfterOutage } from '../lib/reconnect';
import { closeSession, login, type LoginResult, logoutClean, openSession, ROOT } from '../lib/session';
import { pageInGame } from '../lib/tab';
import { tele, VARROCK_WEST_BANK } from './setup';
import { onTutorialIsland } from '../lib/world';
import { waitTicks } from '../lib/wait';

const botArg = process.argv[2];
if (!botArg) throw new Error('usage: measure-relog.ts <bot> [--n=3] [--via=navigate,page] [--restart] [--headful]');
const bot: string = botArg;
const flag = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const n = flag('n') ?? '3';
const via = flag('via') ?? 'navigate,page';
const webPort = process.env.WEB_PORT ?? '9300';
const agentPort = process.env.AGENT_PORT ?? '8300';
const PAGE_PORT = 9398;
const CDP_PORT = 9397;
const log = process.env.LAB_LOG ?? join(process.env.TMPDIR ?? '/tmp', 'speedrun-lab');

// The page server, as RUN-HOST.md step 3 starts it, in front of the lab world.
const proxy = Bun.spawn(
    ['bun', 'proxy.ts', `--world=http://localhost:${webPort}`, `--port=${PAGE_PORT}`, `--gateway=ws://localhost:${agentPort}`, `--bots-dir=${join(ROOT, 'bots')}`],
    { cwd: join(ROOT, 'server', 'webclient'), stdout: Bun.file(join(log, 'proxy.log')), stderr: 'inherit' }
);
const browser = await puppeteer.launch({
    headless: !process.argv.includes('--headful'),
    defaultViewport: null,
    args: ['--no-sandbox', '--window-size=800,660', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${CDP_PORT}`],
});

let status = 1;
const engines: { replacement: Subprocess | null } = { replacement: null };

/** Start a replacement engine the way lab.sh does; resolves at 'World ready'. */
async function startEngine(): Promise<void> {
    const file = join(log, `engine-relog-restart-${process.pid}.log`);
    engines.replacement = Bun.spawn(['bun', 'run', 'src/app.ts'], {
        cwd: join(ROOT, 'server', 'engine'),
        env: { ...process.env, BUILD_VERIFY: 'false', BUILD_LIVE_RELOAD: 'false', LOCAL_STAFF_LEVEL: '4' },
        stdout: openSync(file, 'a'),
        stderr: openSync(file, 'a'),
    });
    const t0 = Date.now();
    while (Date.now() - t0 < 300_000) {
        if (existsSync(file) && readFileSync(file, 'utf-8').includes('World ready')) return;
        await Bun.sleep(200);
    }
    throw new Error(`replacement engine not ready in 300 s (${file})`);
}

/** --restart: kill the engine under a logged-in tab and get back in with the in-page login. */
async function restartRelog(): Promise<number> {
    const cdp = `http://127.0.0.1:${CDP_PORT}`;
    const session = await openSession(bot, { client: 'browser', launch: true, pathfinding: false });
    await waitTicks(session.sdk, 5);
    const lastTick = session.sdk.getState()!.tick;
    process.kill(Number(readFileSync(join(log, 'engine.pid'), 'utf-8').trim()), 'SIGKILL');
    const tKill = Date.now();
    let tPageOut: number | null = null;
    while (Date.now() - tKill < 60_000) {
        if ((await pageInGame(cdp, bot).catch(() => null)) === false) {
            tPageOut = Date.now();
            break;
        }
        await Bun.sleep(200);
    }
    await startEngine();
    const tReady = Date.now();
    let last: LoginResult | null = null;
    const r = await reconnectAfterOutage(session, {
        pollMs: 1_000,
        retryMs: 3_000,
        login: async (s, timeoutMs) => (last = await login(s, { attempts: 1, timeoutMs, inPage: true })),
        onEvent: e => console.log(`[restart] ${JSON.stringify({ ...e, sinceKillMs: e.at - tKill })}`),
    });
    const tIn = Date.now();
    const got = last as LoginResult | null;
    const result = {
        lastTickBeforeKill: lastTick,
        killToPageOutMs: tPageOut === null ? null : tPageOut - tKill,
        killToEngineReadyMs: tReady - tKill,
        engineReadyToInWorldMs: tIn - tReady,
        attempts: r.attempts,
        refusals: r.refusals,
        via: got?.via ?? null,
        tickBase: got?.tickBase ?? null,
        sessionTickAtReturn: session.sdk.getState()!.tick - session.tickBase,
    };
    console.log(`[restart] result ${JSON.stringify(result)}`);
    writeFileSync(join(log, `relog-restart-${bot}.json`), JSON.stringify(result, null, 2) + '\n');
    const out = await logoutClean(session);
    console.log(`[restart] logout: ${out.ok ? `confirmed by ${out.confirmedBy}` : `NOT confirmed (${out.reason})`}`);
    await closeSession(session);
    return out.ok && got?.via === 'page' ? 0 : 1;
}

try {
    await Bun.sleep(1_500);
    const envPath = join(ROOT, 'bots', bot, 'bot.env');
    const lines = readFileSync(envPath, 'utf8').split('\n').filter(l => l && !/^(CLIENT_URL|CDP_URL)=/.test(l));
    lines.push(`CLIENT_URL=http://127.0.0.1:${PAGE_PORT}/bot?server=localhost:${webPort}&gateway=ws://localhost:${agentPort}`, `CDP_URL=http://127.0.0.1:${CDP_PORT}`);
    writeFileSync(envPath, lines.join('\n') + '\n');
    chmodSync(envPath, 0o600);
    if (process.argv.includes('--restart')) {
        status = await restartRelog();
        throw null; // straight to the teardown
    }

    // Off the clock: stand the account beside the Varrock west booths, then out.
    const session = await openSession(bot, { client: 'browser', launch: true, pathfinding: false });
    if (onTutorialIsland(session.sdk.getState()?.player)) {
        const r = await session.bot.skipTutorial();
        if (!r.success) throw new Error(`skipTutorial: ${r.message}`);
        await waitTicks(session.sdk, 5);
    }
    if (!(await tele(session.sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z))) throw new Error('tele to Varrock west bank failed');
    await waitTicks(session.sdk, 3);
    const out = await logoutClean(session);
    if (!out.ok) throw new Error(`setup logout not confirmed (${out.reason})`);
    await closeSession(session);

    const probe = Bun.spawn(['bun', 'speedrun/tools/relog-probe.ts', bot, `--via=${via}`, `--n=${n}`, '--bank', `--json=${join(log, `relog-${bot}.json`)}`], {
        cwd: ROOT,
        stdout: 'inherit',
        stderr: 'inherit',
    });
    status = await probe.exited;
} catch (err) {
    if (err !== null) throw err;
} finally {
    await browser.close().catch(() => {});
    proxy.kill();
    engines.replacement?.kill('SIGKILL');
}
process.exit(status);
