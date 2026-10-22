// Demo acceptance of the Runecraft step module (STEP-MANIFEST.md entry 9, "Demo"; runecraft.md
// section 9): SCORED's stand-in in a browser tab runs the step (the page's rc-cycle program) against
// a real server, and the production altar givers (speedrun/helpers/altar-giver.ts) are launched by the
// run-machine launcher (standalone.ts) from a checkout that has them, sharing one cue directory.
//
// No staff commands. The accounts are staged beforehand:
//   - each giver holds an air talisman and 27 rune essence, with the rest of its essence banked at
//     Falador east (the role's bank restock);
//   - the stand-in holds only an air talisman, at the air ruins or inside the room.
// The givers log in first (a tuned turn needs them handled before the stand-in), the stand-in last.
// Every client is logged out at the end, and each logout is reported.
//
//   timeout --kill-after=60s 25m bun speedrun/lab/runecraft-demo.ts <stand-in> --givers=a,b,c \
//     --giver-root=DIR [--cycles=20] [--path=direct] [--schedule=auto] [--gateway-port=N] [--deadline-min=20]
//
// Every bot.env is read from this checkout's bots/<name>/bot.env. The stand-in's browser login is
// rs/138's token form, so its env needs CLIENT_URL (the page server) and CDP_URL (a running Chrome).
// --gateway-port is the givers' own loopback gateway (default AGENT_PORT + 5, else 7785).
//
// --lab-stage is the dry run on a local lab engine (through lab.sh, as runecraft-accept.ts): it
// writes throwaway bot.env files for the givers, launches its own Chrome for the stand-in, and stages
// every account with staff commands (refused off the lab). The run after the staging is the demo's.
//
// Prints one RESULT line: the step's ticks, the program rows, every turn as rc-cycle judged it,
// and the logouts.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { altarData, enterRoom, isLocalServer } from '../helpers/altar-room';
import { memoryRoleState, type RoleContext } from '../helpers/role';
import { programStatus, stopProgram, type ProgramStatus } from '../lib/programs';
import { closeSession, loadBotEnv, logoutClean, openSession, type LogoutResult, type Session } from '../lib/session';
import { TickLog } from '../lib/ticks';
import { waitUntil } from '../lib/wait';
import { runSteps } from '../runner/step';
import { launchLabBrowser, type LabBrowser } from './browser';
import { leaveTutorial, mustTele } from './setup';
import { altarStep, inRoom, preconditions, rcLevel, rcShared, rcXp, readLauncherFile, xpAfterCrafts, type Band, type ScheduleMode } from '../skills/runecraft';

const ROOT = resolve(import.meta.dir, '..', '..');
const scored: string = process.argv[2] ?? '';
if (!scored || scored.startsWith('--')) throw new Error('usage: runecraft-demo.ts <stand-in> --givers=a,b,c --giver-root=DIR [...]');
const flag = (k: string, d?: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const givers = (flag('givers') ?? '').split(',').filter(Boolean);
if (givers.length < 1 || givers.length > 3) throw new Error('--givers takes 1-3 account names');
const giverRoot = flag('giver-root');
if (!giverRoot || !existsSync(join(giverRoot, 'speedrun/helpers/standalone.ts'))) throw new Error('--giver-root must be a checkout with speedrun/helpers/standalone.ts');
const cycles = Number(flag('cycles', '20'));
const schedule = flag('schedule', 'auto') as ScheduleMode;
const path = flag('path');
const labStage = process.argv.includes('--lab-stage');
const deadlineMs = Number(flag('deadline-min', '20')) * 60_000;
const gatewayPort = Number(flag('gateway-port', String(process.env.AGENT_PORT ? Number(process.env.AGENT_PORT) + 5 : 7785)));
/** Givers restock at Falador east between batches (91-93 ticks a round trip, altar-giver.md): wait out about four. */
const GIVER_WAIT_TICKS = 400;

const altar = altarData('air');
const base = mkdtempSync(join(tmpdir(), 'rc-demo-'));
const runDir = join(base, 'run');
const cueDir = join(runDir, 'rc-cue');
mkdirSync(cueDir, { recursive: true, mode: 0o700 });
process.env.RC_CUE_DIR = cueDir;
const botsDir = labStage ? join(base, 'bots') : join(ROOT, 'bots');

if (labStage) {
    if (!isLocalServer(loadBotEnv(scored).SERVER)) throw new Error('--lab-stage is for the local lab engine only');
    const webPort = process.env.WEB_PORT ?? '9300';
    for (const account of givers) {
        mkdirSync(join(botsDir, account), { recursive: true, mode: 0o700 });
        writeFileSync(join(botsDir, account, 'bot.env'), `BOT_USERNAME=${account}\nPASSWORD=${randomBytes(6).toString('hex')}\nSERVER=localhost:${webPort}\nSHOW_CHAT=false\nTELEMETRY=false\n`, { mode: 0o600 });
    }
} else {
    for (const account of [...givers, scored]) loadBotEnv(account, botsDir); // fail before any login
    if (isLocalServer(loadBotEnv(scored).SERVER)) throw new Error('without --lab-stage this is the demo: the stand-in must point at a real server');
}

const config = {
    gatewayPort,
    botsDir,
    runDir,
    loginSpacingMs: 3000,
    accounts: givers.map((account, i) => ({ account, role: 'altar-giver', ...(path ? { path } : {}), options: { altar: 'air', slot: i % 3, essence: 27, restock: { kind: 'bank', ...(labStage ? { labStock: true } : {}) }, scope: { step: 'DEMO', family: 'altar' } } })) // the band id below
};
writeFileSync(join(base, 'launch.json'), JSON.stringify(config, null, 2));
console.log(`runecraft-demo: ${givers.length} givers (${path ?? 'relay'}), ${cycles} cycles at air, schedule ${schedule}${labStage ? ', lab-staged' : ''}; run files in ${base}`);

let launcher: ReturnType<typeof Bun.spawn> | null = null;
let session: Session | null = null;
let browser = null as LabBrowser | null;
let lastRc = null as ProgramStatus | null;
let exit = 0;
const log = TickLog.open(undefined, join(base, 'ticks.jsonl'));
const logouts: Record<string, string> = {};
const deadline = Date.now() + deadlineMs;
const remaining = () => Math.max(0, deadline - Date.now());

async function giversReady(): Promise<void> {
    launcher = Bun.spawn([process.execPath, 'speedrun/helpers/standalone.ts', join(base, 'launch.json')], {
        cwd: giverRoot,
        env: { ...process.env, RC_CUE_DIR: cueDir, ...(labStage ? { HELPER_LAB_TELE: '1' } : {}) },
        stdout: Bun.file(join(base, 'launcher.log')),
        stderr: Bun.file(join(base, 'launcher.err'))
    });
    const t0 = Date.now();
    for (;;) {
        const l = readLauncherFile(runDir);
        const ready = givers.filter(g => {
            try {
                const s = JSON.parse(readFileSync(join(cueDir, `giver-${g}.json`), 'utf8'));
                return (s.phase === 'ready' || s.phase === 'armed') && s.inRoom && Date.now() - s.ms < 5000;
            } catch {
                return false;
            }
        });
        if (l?.helpersReady && ready.length === givers.length) break;
        if (Date.now() - t0 > Math.min(600_000, remaining())) throw new Error(`givers not ready after ${Math.round((Date.now() - t0) / 1000)} s (ready: ${ready.join(', ') || 'none'}; see ${runDir}/logs)`);
        await Bun.sleep(500);
    }
    // standalone.ts takes a giver's path from the account entry, not the role options; a misplaced
    // `path` silently falls back to the relay, so fail on any giver the launcher resolved otherwise.
    const resolved = (JSON.parse(readFileSync(join(runDir, 'launcher.json'), 'utf8')) as { accounts: { account: string; path?: string }[] }).accounts.filter(a => givers.includes(a.account));
    console.log(`givers ready after ${Math.round((Date.now() - t0) / 1000)} s; paths ${resolved.map(a => `${a.account}:${a.path}`).join(', ')}`);
    if (resolved.some(a => a.path !== (path ?? 'relay'))) throw new Error(`the launcher resolved ${resolved.map(a => `${a.account}:${a.path}`).join(', ')}, not ${path ?? 'relay'}`);
}

/** The stand-in's login: the token form over CDP on the demo; the lab's own Chrome and the query form with --lab-stage. */
async function standInSession(): Promise<Session> {
    if (!labStage) return openSession(scored, { client: 'browser', launch: true });
    browser = await launchLabBrowser(scored, { headless: process.argv.includes('--headless'), cdpPort: Number(process.env.WEB_PORT ?? 9300) + 6 });
    return openSession(scored, { client: 'browser', launch: true, insecureQueryLogin: true });
}

function roleContext(s: Session, abort: AbortController): RoleContext {
    return {
        bot: s.bot,
        sdk: s.sdk,
        account: scored,
        options: {},
        log: (message, data) => console.log(`stand-in: ${message}${data ? ` ${JSON.stringify(data)}` : ''}`),
        reportBank: () => {},
        signal: abort.signal,
        state: memoryRoleState()
    } as RoleContext;
}

try {
    await giversReady();
    session = await standInSession();
    const sdk = session.sdk;
    sdk.onStateUpdate(s => {
        const st = programStatus(s);
        if (st?.name === 'rc-cycle') lastRc = st;
    });
    const first = await waitUntil(sdk, s => !!s.inGame && !!s.player, { maxTicks: 30 });
    if (!first.ok) throw new Error('the stand-in is not in game');
    if (labStage) {
        // Lab staging only: the demo's accounts arrive staged. The stand-in starts outside the ruins, so the run takes the real way in.
        const say = async (cmd: string) => {
            await sdk.sendSay(cmd);
            await sdk.waitForTicks(2);
        };
        await leaveTutorial(session, log);
        await say('::~clearinv inv');
        await say(`::give ${altar.talismanObj} 1`);
        await mustTele(sdk, altar.exit.x, altar.exit.z, altar.exit.level);
        await waitUntil(sdk, s => s.inventory.some(i => altar.talisman.test(i.name)), { maxTicks: 10 });
    }
    const abort = new AbortController();
    // After a login or a teleport the position is published a few frames before the scene's locs.
    const ruinsOrRoom = (s: NonNullable<ReturnType<typeof sdk.getState>>) => inRoom(s, 'air') || s.nearbyLocs.some(l => /mysterious ruins/i.test(l.name));
    if (!(await waitUntil(sdk, ruinsOrRoom, { maxTicks: 15 })).ok) throw new Error('the stand-in is not staged: neither in the air altar room nor at the ruins');
    if (!inRoom(sdk.getState()!, 'air')) await enterRoom(roleContext(session, abort), altar);
    const s0 = sdk.getState()!;
    const xp0 = rcXp(s0);
    const band: Band = { id: 'DEMO', altar: 'air', from: rcLevel(s0), untilLevel: 99, untilXp: xpAfterCrafts('air', xp0, cycles) };
    const ok = preconditions(s0, band);
    if (ok !== true) throw new Error(`the stand-in is not staged: ${ok}`);
    const step = altarStep(band, { schedule, cueDir, runDir, fallback: 'none', giverWaitTicks: GIVER_WAIT_TICKS });
    const run = runSteps(session, [step], { log, c: {}, shouldStop: () => false, logout: async () => {} });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const out = await Promise.race([run.then(r => ({ r })), new Promise<{ r: null }>(res => (timer = setTimeout(() => res({ r: null }), remaining())))]);
    clearTimeout(timer);
    if (!out.r) {
        await stopProgram(sdk).catch(() => null);
        await run.catch(() => null);
        throw new Error(`deadline: ${deadlineMs / 60_000} min`);
    }
    console.log(`completed ${out.r.completed}`);
} catch (e) {
    exit = 1;
    console.error(`runecraft-demo failed: ${e instanceof Error ? e.message : String(e)}`);
} finally {
    const stepRows = log.rows.filter(r => !r.kind && r.step.endsWith('runecraft'));
    const programs = log.rows.filter(r => r.kind === 'program').map(r => ({ ok: r.ok, ticks: r.ticks, ...(r.error ? { error: r.error } : {}), ...r.meta }));
    const turns = (rcShared(lastRc)?.results ?? []).map(t => ({ giver: t.giver, T: t.T, schedule: t.schedule, outcome: t.outcome, tick: t.tick, ...(t.order ? { order: t.order } : {}), ...(t.detail ? { detail: t.detail } : {}) }));
    const inventory = session?.sdk.getState()?.inventory.map(i => `${i.name}${i.count > 1 ? ` x${i.count}` : ''}`) ?? [];
    // Logouts: the stand-in first (its tab), then the launcher stops each giver by the logout button.
    if (session) {
        const r: LogoutResult | null = await logoutClean(session).catch(e => {
            logouts[scored] = `error: ${e instanceof Error ? e.message : String(e)}`;
            return null;
        });
        if (r) logouts[scored] = r.ok ? `logged out (${r.confirmedBy ?? 'confirmed'})` : `NOT CONFIRMED: ${r.reason}`;
        await closeSession(session).catch(() => {});
    }
    if (launcher) {
        (launcher as { kill(sig?: string): void }).kill('SIGINT');
        await Promise.race([(launcher as { exited: Promise<unknown> }).exited, Bun.sleep(60_000)]);
        const final = existsSync(join(runDir, 'launcher.json')) ? (JSON.parse(readFileSync(join(runDir, 'launcher.json'), 'utf8')) as { accounts: { account: string; logout?: string | null }[] }) : { accounts: [] };
        for (const g of givers) {
            const o = final.accounts.find(a => a.account === g)?.logout;
            logouts[g] = o === 'out' ? 'logged out (launcher)' : o === 'not-in-world' ? 'logged out (never in world)' : `NOT CONFIRMED: ${o ?? 'no outcome in launcher.json'}`;
        }
    }
    if (browser) await browser.kill().catch(() => {});
    if (Object.values(logouts).some(v => !v.startsWith('logged out'))) exit = 1;
    const stepRow = stepRows.length ? { ticks: stepRows.reduce((n, r) => n + r.ticks, 0), ok: stepRows.every(r => r.ok) } : undefined;
    console.log(`RESULT ${JSON.stringify({ scored, givers, cycles, schedule, path: path ?? 'relay', labStage, stepTicks: stepRow?.ticks ?? null, stepOk: stepRow?.ok ?? false, programs, turns, inventory, logouts, runFiles: base })}`);
}
process.exit(exit);
