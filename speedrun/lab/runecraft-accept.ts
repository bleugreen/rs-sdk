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
//   --arrive=tele|leg  tele (default): ::tele into the room. leg: stage at the leg's start with its runes and
//                      Magic 37, run the real leg (air T05-06; body T20-21, the body route) through
//                      runner/legs.ts runLeg, and start the step on the landing, so the step's first
//                      clicks come right after the ruins' teleport (main's browser-client standard, rs/308)
//   --hand-back        S21's hand-back: one more giver (cairn_rch1, rs/383's `handBack` option, bank restock)
//                      staged in its own tab with only its talisman and the Lumbridge runes; the band
//                      carries S21_HAND_BACK, so the step names it after the last craft
//   --headless         Chrome without a window
// The scored stand-in is the lab bot named on the lab.sh line; never the scored account.
// Prints one RESULT line with the step's ticks and the program rows.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { closeSession, login, logoutClean, openSession, type Session } from '../lib/session';
import { TickLog } from '../lib/ticks';
import { waitUntil } from '../lib/wait';
import { readCue } from '../helpers/altar-cue';
import { programStatus } from '../lib/programs';
import { Observation, resolveResume, runResumable, sessionLink } from '../runner/resume';
import { BODY_ALTAR_LEGS, legById, runLeg, type LegStep } from '../runner/legs';
import { runSteps } from '../runner/step';
import { labClientUrl, launchLabBrowser } from './browser';
import { mustTele } from './setup';
import { onTutorialIsland } from '../lib/world';
import { tutorialSkip } from '../skills/start';
import { ALTAR_ROOMS, altarStep, craftXp, findAltar, rcLevel, rcXp, xpAfterCrafts, S21_HAND_BACK, type AltarName, type Band, type ScheduleMode } from '../skills/runecraft';
import { altarGiverLaunch, spawnAltarGivers, stopAltarGivers, waitAltarGiversReady, writeLabBotEnvs, type GiverPath } from './altar-launch';

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
/** --hand-back: one more giver, staged with its talisman and the Lumbridge runes, trades them after the last craft (S21's H17e). */
const handBack = process.argv.includes('--hand-back');
const HB = 'cairn_rch1';
/** The band's id is the cue's step: the givers read only the cue scoped to it. */
const bandId = altar === 'air' && level === 1 && untilLevel === '44' ? 'S06' : 'LAB';
const arrive = flag('arrive', 'tele')!;
if (arrive !== 'tele' && arrive !== 'leg') throw new Error('--arrive must be tele or leg');
/** The leg that lands in each room; the nature route (the Brimhaven ship) is not staged here. */
const ARRIVAL_LEG: Partial<Record<AltarName, () => LegStep>> = { air: () => legById('T05-06'), body: () => legById('T20-21', BODY_ALTAR_LEGS) };
if (arrive === 'leg' && !ARRIVAL_LEG[altar]) throw new Error(`--arrive=leg has no staged leg into the ${altar} room (air or body)`);
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
const helpers = handBack ? [...givers, HB] : givers;
writeLabBotEnvs(botsDir, helpers, `localhost:${webPort}`);
const config = altarGiverLaunch({
    givers,
    band: { id: bandId, altar },
    botsDir,
    runDir,
    gatewayPort: agentPort + 5,
    ...(path ? { path: path as GiverPath } : {}),
    ...(handBack ? { handBack: { account: HB, items: S21_HAND_BACK.items } } : {})
});
console.log(`runecraft-accept: ${altar} from ${level}, ${cycles ? `${cycles} cycles` : `until ${untilLevel ?? 99}`}, schedule ${schedule}, ${order}, ${givers.length} givers${path ? ` (${path})` : ''}; run files in ${base}`);

// the block's spare ports: the givers' loopback gateway on AGENT_PORT+5, Chrome's DevTools on WEB_PORT+5
const cdpPort = Number(webPort) + 5;
const chrome = await launchLabBrowser(scored, { headless, cdpPort });

let launcher: Subprocess | null = null;
const startGivers = async () => {
    const l = spawnAltarGivers({ root: giverRoot, base, config, cueDir });
    launcher = l;
    console.log(`givers ready after ${await waitAltarGiversReady(l, { runDir, cueDir, accounts: helpers })} s`);
};


let session: Session | null = null;
/** The arrival leg's figures under --arrive=leg. */
let legRow: Record<string, unknown> | null = null;
const log = TickLog.open(undefined, join(base, 'ticks.jsonl'));
let exit = 0;
try {
    if (handBack) {
        // its own tab, once: out of the tutorial, then only its talisman and the runes (rs/383: 'carry them in')
        const hbEnv = join(process.cwd(), 'bots', HB);
        mkdirSync(hbEnv, { recursive: true, mode: 0o700 });
        writeFileSync(join(hbEnv, 'bot.env'), readFileSync(join(botsDir, HB, 'bot.env'), 'utf8').trimEnd() + `\nGATEWAY_URL=ws://localhost:${agentPort}\nCLIENT_URL=${labClientUrl()}\n`, { mode: 0o600 });
        console.log('hand-back giver: staging in its own tab');
        const hb = await openSession(HB, { client: 'browser', launch: true, insecureQueryLogin: true });
        console.log('hand-back giver: session open');
        if (onTutorialIsland(hb.sdk.getState()?.player)) await runSteps(hb, [tutorialSkip], { log: TickLog.memory('hb'), c: {}, shouldStop: () => false, logout: async () => {} });
        const sayHb = async (cmd: string) => { await hb.sdk.sendSay(cmd); await hb.sdk.waitForTicks(2); };
        while (hb.sdk.getState()?.dialog.isOpen) { await hb.sdk.sendClickDialog(0); await hb.sdk.waitForTicks(1); }
        await sayHb('::~clearinv inv');
        for (const [obj, n] of [[TALISMAN_OBJ[altar], 1], ['lawrune', 1], ['airrune', 3], ['earthrune', 1]] as const) await sayHb(`::give ${obj} ${n}`);
        console.log(`hand-back giver staged: ${hb.sdk.getState()!.inventory.map(i => `${i.name} x${i.count}`).join(', ')}`);
        console.log(`hand-back giver staging logout: ${JSON.stringify(await logoutClean(hb))}`);
        await closeSession(hb).catch(() => {});
    }
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
    if (arrive === 'leg') {
        // the leg's Falador teleport (1 law, 3 air, 1 water at Magic 37), staged at the leg's start, never at a click tile
        const l = ARRIVAL_LEG[altar]!();
        await say('::setstat magic 37');
        for (const [obj, n] of [['lawrune', 1], ['airrune', 3], ['waterrune', 1]] as const) await say(`::give ${obj} ${n}`);
        await mustTele(sdk, l.def.start.x, l.def.start.z);
        if (order === 'scored-first') await startGivers();
        const t0 = sdk.getState()!.tick;
        const r = await runLeg(l.def, { sdk, bot: session.bot, log, session }, l.name);
        legRow = { leg: l.def.id, ticks: sdk.getState()!.tick - t0, travelTicks: r?.ticks ?? null, expected: l.def.expected.ticks, clicks: r?.clicks ?? null };
        console.log(`arrived by ${l.def.id}: ${JSON.stringify(legRow)}`);
    } else await say(`::tele ${LAB_ENTER[altar]}`);
    const inRoom = await waitUntil(sdk, s => (arrive === 'leg' || !!findAltar(s)) && rcLevel(s) === level && s.inventory.some(i => ALTAR_ROOMS[altar].talisman.test(i.name)), { maxTicks: 40 });
    if (!inRoom.ok) throw new Error('the stand-in did not reach the altar room with its talisman at the band level');
    if (order === 'scored-first' && arrive === 'tele') await startGivers();

    const xp0 = rcXp(sdk.getState()!);
    const band: Band = {
        id: bandId,
        altar,
        from: level,
        untilLevel: Number(untilLevel ?? 99),
        ...(cycles ? { untilXp: xpAfterCrafts(altar, xp0, Number(cycles)) } : {}),
        ...(handBack ? { handBack: S21_HAND_BACK } : {})
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
            void chrome.browser.pages().then(ps => ps.find(p => p.url().includes(`bot=${scored}`))?.reload()).then(() => console.log(`reloaded the page after ${reloadAfter} crafts`));
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
    const arrival = legRow;
    const stepStart = log.rows.find(r => !r.kind && r.step.endsWith('runecraft'))?.startTick ?? null;
    const handBackRows = log.rows.filter(r => r.step === 'runecraft:hand-back').map(r => ({ ok: r.ok, ...(r.error ? { error: r.error } : {}), ...r.meta }));
    console.log(`RESULT ${JSON.stringify({ handBackRows, altar, level, order, schedule, arrive, arrival, stepStart, path: path ?? 'relay', givers: givers.length, stepTicks: stepRow?.ticks ?? null, stepOk: stepRow?.ok ?? false, programs, inventory, log: join(base, 'ticks.jsonl') })}`);
    if (session) {
        await logoutClean(session).catch(() => {});
        await closeSession(session).catch(() => {});
    }
    const l = launcher as Subprocess | null;
    if (l) await stopAltarGivers(l, 20_000);
    await chrome.kill().catch(() => {});
}
process.exit(exit);
