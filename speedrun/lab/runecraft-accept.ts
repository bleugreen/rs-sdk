// Lab acceptance for the Runecraft step module (speedrun/skills/runecraft.ts,
// STEP-MANIFEST.md entry 9): SCORED's stand-in in a browser tab running the step
// (the page's rc-cycle program), and the production altar givers
// (speedrun/helpers/altar-giver.ts) launched by the run-machine launcher
// (standalone.ts) from a separate checkout that has them, sharing one cue
// directory. Through lab.sh, which starts the engine and gateway (no lite runner):
//
//   NODE_TICKRATE=300 LAB_RUNNERS=0 WEB_PORT=9270 WEB_MANAGEMENT_PORT=9271 HISCORES_WEB_PORT=9272 NODE_PORT=43970 AGENT_PORT=8170 \
//     speedrun/lab/lab.sh rclabs speedrun/lab/runecraft-accept.ts:--giver-root=/path/to/helpers-checkout:--order=givers-first:--cycles=30
//
// Options:
//   --giver-root=DIR   checkout with speedrun/helpers/standalone.ts and altar-giver.ts (required)
//   --order=givers-first|scored-first   who logs in first (tuned needs the givers first)
//   --schedule=auto|tuned|robust        the step's schedule mode (default auto)
//   --altar=nature|air|body             (default nature)
//   --level=N          SCORED's Runecraft level at the start (default the altar's band start)
//   --cycles=N         stop after N crafts (untilXp); or --until-level=N
//   --givers=N         1-3 givers (default 3)
//   --path=relay|direct  the givers' send path, when their checkout has the option
//   --fallback=stock|none, --giver-wait=TICKS  passed to the step
//   --relog-after=N    log out cleanly after N crafts, log back in, and resume through the resume walk
//   --reload-after=N   reload SCORED's page after N crafts, with the step under runResumable
//   --junk-after=N     ::give SCORED a junk item after N crafts (26 free slots: every trade fails, the
//                      program faults); with --junk-clear it is dropped once the next program run starts,
//                      with --junk-clear-stock once the cue carries the stock rung's first turn
//   --headless         Chrome without a window
// The scored stand-in is the lab bot named on the lab.sh line; never the scored account.
// Prints one RESULT line with the step's ticks and the program rows.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { closeSession, login, logoutClean, openSession, type Session } from '../lib/session';
import { TickLog } from '../lib/ticks';
import { waitUntil } from '../lib/wait';
import { readCue } from '../helpers/altar-cue';
import { programStatus } from '../lib/programs';
import { Observation, resolveResume, runResumable, sessionLink } from '../runner/resume';
import { runSteps } from '../runner/step';
import { onTutorialIsland } from '../lib/world';
import { tutorialSkip } from '../skills/start';
import { ALTAR_ROOMS, altarStep, craftXp, findAltar, rcLevel, rcXp, readLauncherFile, xpAfterCrafts, type AltarName, type Band, type ScheduleMode } from '../skills/runecraft';

const scored = process.argv[2];
if (!scored) throw new Error('usage: runecraft-accept.ts <lab-scored-bot> --giver-root=DIR [...]');
const flag = (k: string, d?: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const giverRoot = flag('giver-root');
if (!giverRoot || !existsSync(join(giverRoot, 'speedrun/helpers/standalone.ts'))) throw new Error('--giver-root must be a checkout with speedrun/helpers/standalone.ts');
const order = flag('order', 'givers-first')!;
const schedule = flag('schedule', 'auto') as ScheduleMode;
const altar = flag('altar', 'nature') as AltarName;
const level = Number(flag('level', String(altar === 'air' ? 1 : 44)));
const cycles = flag('cycles');
const untilLevel = flag('until-level');
const nGivers = Number(flag('givers', '3'));
const path = flag('path');
const headless = process.argv.includes('--headless');
const webPort = process.env.WEB_PORT ?? '9300';
const agentPort = Number(process.env.AGENT_PORT ?? 8300);

/** The room's entry tile (enter_coord), for the lab's ::tele. */
const LAB_ENTER: Record<AltarName, string> = { air: '0,44,75,25,30', nature: '0,37,75,32,35', body: '0,39,75,27,38' };
const TALISMAN_OBJ: Record<AltarName, string> = { air: 'air_talisman', nature: 'nature_talisman', body: 'body_talisman' };

const base = mkdtempSync(join(tmpdir(), 'rc-accept-'));
const runDir = join(base, 'run');
const cueDir = join(runDir, 'rc-cue');
const botsDir = join(base, 'bots');
mkdirSync(cueDir, { recursive: true, mode: 0o700 });
process.env.RC_CUE_DIR = cueDir;
// standalone.ts takes only cairn_ helper names (fleet-config.ts ACCOUNT_NAME_RE); these exist on the lab engine alone
const givers = Array.from({ length: nGivers }, (_, i) => `cairn_rcg${i + 1}`);
for (const account of givers) {
    mkdirSync(join(botsDir, account), { recursive: true, mode: 0o700 });
    writeFileSync(join(botsDir, account, 'bot.env'), `BOT_USERNAME=${account}\nPASSWORD=${randomBytes(6).toString('hex')}\nSERVER=localhost:${webPort}\nSHOW_CHAT=false\nTELEMETRY=false\nPROFANITY_FILTER=false\n`, { mode: 0o600 });
}
const config = {
    gatewayPort: agentPort + 5,
    botsDir,
    runDir,
    loginSpacingMs: 2000,
    accounts: givers.map((account, i) => ({ account, role: 'altar-giver', ...(path ? { path } : {}), options: { altar, slot: i % 3, essence: 27, restock: { kind: 'cheat' } } }))
};
writeFileSync(join(base, 'launch.json'), JSON.stringify(config, null, 2));
console.log(`runecraft-accept: ${altar} from ${level}, ${cycles ? `${cycles} cycles` : `until ${untilLevel ?? 99}`}, schedule ${schedule}, ${order}, ${givers.length} givers${path ? ` (${path})` : ''}; run files in ${base}`);

// the block's spare ports: the givers' loopback gateway on AGENT_PORT+5, Chrome's DevTools on WEB_PORT+5
const cdpPort = Number(webPort) + 5;
const browser = await puppeteer.launch({
    headless,
    defaultViewport: null,
    args: ['--no-sandbox', '--window-size=800,660', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${cdpPort}`]
});
process.env.SPEEDRUN_CDP_URL = `http://127.0.0.1:${cdpPort}`;

let launcher: ReturnType<typeof Bun.spawn> | null = null;
const startGivers = async () => {
    launcher = Bun.spawn([process.execPath, 'speedrun/helpers/standalone.ts', join(base, 'launch.json')], {
        cwd: giverRoot,
        env: { ...process.env, HELPER_LAB_TELE: '1', RC_CUE_DIR: cueDir },
        stdout: Bun.file(join(base, 'launcher.log')),
        stderr: Bun.file(join(base, 'launcher.err'))
    });
    // ready: every giver logged in (launcher.json) and standing loaded in the room (its status file)
    const t0 = Date.now();
    for (;;) {
        const l = readLauncherFile(runDir);
        const ready = givers.filter(g => {
            try {
                const s = JSON.parse(readFileSync(join(cueDir, `giver-${g}.json`), 'utf8'));
                return s.phase === 'ready' && s.inRoom && Date.now() - s.ms < 5000;
            } catch {
                return false;
            }
        });
        if (l?.helpersReady && ready.length === givers.length) break;
        if (Date.now() - t0 > 240_000) throw new Error(`givers not ready after 240 s (ready: ${ready.join(', ') || 'none'}; see ${base}/run/logs)`);
        await Bun.sleep(500);
    }
    console.log(`givers ready after ${Math.round((Date.now() - t0) / 1000)} s`);
};

// The page publishes to the gateway named in its URL; without one it uses the default port, not the lab's.
const scoredEnv = join(process.cwd(), 'bots', scored, 'bot.env');
const envText = readFileSync(scoredEnv, 'utf8');
const clientUrl = `CLIENT_URL=http://localhost:${webPort}/bot?gateway=${encodeURIComponent(`ws://localhost:${agentPort}`)}`;
writeFileSync(scoredEnv, envText.replace(/^CLIENT_URL=.*\n?/m, '').trimEnd() + `\n${clientUrl}\n`, { mode: 0o600 });

let session: Session | null = null;
const log = TickLog.open(undefined, join(base, 'ticks.jsonl'));
let exit = 0;
try {
    if (order === 'givers-first') await startGivers();
    session = await openSession(scored, { client: 'browser', launch: true, insecureQueryLogin: true });
    const sdk = session.sdk;
    const say = async (cmd: string) => {
        await sdk.sendSay(cmd);
        await sdk.waitForTicks(2);
    };
    // A new lab account logs in on Tutorial Island, where the login script clears every side tab
    // (tutorial.rs2 start_tutorial) and the server then ignores inventory ops, the talisman drop
    // included. A ::tele off the island doesn't restore them; S00's skip does, as in the run.
    if (onTutorialIsland(sdk.getState()?.player)) await runSteps(session, [tutorialSkip], { log, c: {}, shouldStop: () => false, logout: async () => {} });
    // The stand-in: nothing in the inventory but the altar's talisman, the band's level, in the room.
    while (sdk.getState()?.dialog.isOpen) {
        await sdk.sendClickDialog(0);
        await sdk.waitForTicks(1);
    }
    await say('::~clearinv inv');
    await say(`::setstat runecraft ${level}`);
    await say(`::give ${TALISMAN_OBJ[altar]} 1`);
    await say(`::tele ${LAB_ENTER[altar]}`);
    const inRoom = await waitUntil(sdk, s => !!findAltar(s) && rcLevel(s) === level && s.inventory.some(i => ALTAR_ROOMS[altar].talisman.test(i.name)), { maxTicks: 40 });
    if (!inRoom.ok) throw new Error('the stand-in did not reach the altar room with its talisman at the band level');
    if (order === 'scored-first') await startGivers();

    const xp0 = rcXp(sdk.getState()!);
    const band: Band = {
        id: altar === 'air' && level === 1 && untilLevel === '44' ? 'S06' : 'LAB',
        altar,
        from: level,
        untilLevel: Number(untilLevel ?? 99),
        ...(cycles ? { untilXp: xpAfterCrafts(altar, xp0, Number(cycles)) } : {})
    };
    const fallback = flag('fallback') as 'stock' | 'none' | undefined;
    const giverWait = flag('giver-wait');
    // Lab disturbances, keyed on crafts seen (xp steps of one load).
    const perCraft = craftXp(altar);
    const crafts = () => Math.floor((rcXp(sdk.getState()!) - xp0) / perCraft + 0.01);
    const reloadAfter = flag('reload-after');
    const junkAfter = flag('junk-after');
    let reloaded = false;
    let junked: number | null = null;
    let cleared = false;
    const unwatch = sdk.onStateUpdate(s => {
        if (!s.inGame) return;
        if (reloadAfter && !reloaded && crafts() >= Number(reloadAfter)) {
            reloaded = true;
            void browser.pages().then(ps => ps.find(p => p.url().includes(`bot=${scored}`))?.reload()).then(() => console.log(`reloaded the page after ${reloadAfter} crafts`));
        }
        if (junkAfter && junked === null && crafts() >= Number(junkAfter)) {
            junked = programStatus(s)?.runId ?? 0;
            void sdk.sendSay('::give bronze_axe 1').then(() => console.log(`junk given after ${junkAfter} crafts`));
        }
        const run = programStatus(s)?.runId ?? 0;
        const clearNow = process.argv.includes('--junk-clear') ? run > (junked ?? Infinity) : process.argv.includes('--junk-clear-stock') && !!readCue(cueDir)?.turns.some(t => (t.schedule as string | undefined) === 'stock');
        if (junked !== null && !cleared && clearNow) {
            const axe = s.inventory.find(i => /^bronze axe$/i.test(i.name));
            if (axe) {
                cleared = true;
                void sdk.sendDropItem(axe.slot).then(() => console.log(`junk dropped ${process.argv.includes('--junk-clear') ? `as program run ${run} started` : 'as the stock rung started'}`));
            }
        }
    });
    const stepOpts = { schedule, cueDir, runDir, ...(fallback ? { fallback } : {}), ...(giverWait ? { giverWaitTicks: Number(giverWait) } : {}) };
    const step = altarStep(band, stepOpts);
    const relogAfter = flag('relog-after');
    if (relogAfter) {
        // the first part stops at N crafts; the account logs out between cycles and the walk resumes the band
        const part: Band = { ...band, untilXp: xpAfterCrafts(altar, xp0, Number(relogAfter)) };
        await runSteps(session, [altarStep(part, stepOpts)], { log, c: {}, shouldStop: () => false, logout: async () => {} });
        const out = await logoutClean(session);
        console.log(`logged out after ${relogAfter} crafts: ${JSON.stringify(out)}`);
        await Bun.sleep(2_000);
        await login(session);
        const obs = new Observation(session.sdk.getState()!);
        const point = await resolveResume([step], obs, {});
        console.log(`resume walk: ${point.mode} ${point.step ?? ''} (${point.reason})`);
        if (point.mode === 'finished') throw new Error('the resume walk found the band finished after the relog');
        await runSteps(session, [step], { log, c: {}, shouldStop: () => false, logout: async () => {}, startMode: point.mode === 'resume' ? 'resume' : 'run', observed: obs });
    } else if (reloadAfter) {
        const r = await runResumable(session, [step], {
            log,
            c: {},
            link: sessionLink(session),
            shouldStop: () => false,
            logout: async () => {},
            onEvent: e => console.log(`resumable: ${JSON.stringify(e)}`)
        });
        console.log(`completed ${r.completed}, drops ${r.drops}`);
    } else {
        const r = await runSteps(session, [step], { log, c: {}, shouldStop: () => false, logout: async () => {} });
        console.log(`completed ${r.completed}`);
    }
    unwatch();
} catch (e) {
    exit = 1;
    console.error(`runecraft-accept failed: ${e instanceof Error ? e.message : String(e)}`);
} finally {
    const stepRows = log.rows.filter(r => !r.kind && r.step.endsWith('runecraft'));
    const stepRow = stepRows.length ? { ticks: stepRows.reduce((n, r) => n + r.ticks, 0), ok: stepRows.every(r => r.ok) } : undefined;
    const programs = log.rows.filter(r => r.kind === 'program').map(r => ({ ok: r.ok, ticks: r.ticks, ...(r.error ? { error: r.error } : {}), ...r.meta }));
    const inventory = session?.sdk.getState()?.inventory.map(i => `${i.name}${i.count > 1 ? ` x${i.count}` : ''}`) ?? [];
    console.log(`RESULT ${JSON.stringify({ altar, level, order, schedule, path: path ?? 'relay', givers: givers.length, stepTicks: stepRow?.ticks ?? null, stepOk: stepRow?.ok ?? false, programs, inventory, log: join(base, 'ticks.jsonl') })}`);
    if (session) {
        await logoutClean(session).catch(() => {});
        await closeSession(session).catch(() => {});
    }
    if (launcher) {
        (launcher as { kill(sig?: string): void }).kill('SIGINT');
        await Promise.race([(launcher as { exited: Promise<unknown> }).exited, Bun.sleep(20_000)]);
    }
    await browser.close().catch(() => {});
}
process.exit(exit);
