// Lab probe and acceptance for the Wilderness course's ridge gate (loc 2309 at (2998,3917),
// wilderness_course.rs2) on the browser client (cairn://p/rs/494). The gate is the ridge obstacle
// itself: its only op is Open, and that op forcemoves the player north up the one-tile corridor
// (x 2998, z 3917-3930) into the course, or drops them into the wolf pit east of it.
//
//   NODE_TICKRATE=400 LAB_RUNNERS=0 speedrun/lab/lab.sh <fresh-bot> speedrun/lab/ridge-gate.ts:--phases=probe-walk,probe-corridor,north,pit,chain
//
// The page must be this checkout's bundle (`bun run build` in server/webclient first). Chrome runs
// headless unless --headful; --cpu-throttle=N slows the tab N-fold for the chain phase, stretching
// each region build toward the demo's. Prints one RESULT line per phase, a TRACE of every position,
// scene and dialogue change and every click with its result, and the SDK's [walkTo] lines.
//
// Phases (each stages its own start with ::tele, Agility 52, Hitpoints 70 and a knife):
//   probe-walk      bot.walkTo the ridge gate's south tile (2998,3916) from (3006,3911), the route's
//                   last leg, with nothing of agility.ts in the way: what the SDK's door opener does
//   probe-corridor  from (2998,3918), inside the corridor north of the gate: the ridge gate clicked,
//                   then (re-staged) the course gate's right half (loc 2307 at (2998,3931)) clicked
//   north           agility:walk-wilderness from (2998,3918): must leave the corridor, then cross
//   pit             agility:walk-wilderness from the wolf pit (3001,3922), where a ridge fall lands
//   chain           agility:walk-wilderness from (2538,3350), rs/310's session D start: the lever
//                   walk, the lever, the keep web, keepToRidge and the ridge, each walk leg starting
//                   on a region build
import type { ActionResult, BotWorldState } from '../../sdk/types';
import { closeSession, logoutClean, openSession, type Session } from '../lib/session';
import { TickLog } from '../lib/ticks';
import { waitUntil } from '../lib/wait';
import { pos } from '../lib/world';
import { runSteps } from '../runner/step';
import { COURSE_GATE, inWildCourse, RIDGE_GATE, steps as agilitySteps } from '../skills/agility';
import { launchLabBrowser } from './browser';
import { arg, botArg, result } from './common';
import { clearInventory, give, leaveTutorial, mustTele, setStats } from './setup';

const bot = botArg();
const phases = arg('phases', 'probe-walk,probe-corridor,north,pit,chain').split(',');
const headless = !process.argv.includes('--headful');
const throttleArg = process.argv.find(a => a.startsWith('--cpu-throttle='))?.slice('--cpu-throttle='.length);
const throttle = throttleArg === undefined ? null : Number(throttleArg);

const CORRIDOR: [number, number] = [2998, 3918];
const PIT: [number, number] = [3001, 3922];
const LAST_LEG: [number, number] = [3006, 3911];
const CHAIN_START: [number, number] = [2538, 3350];
const inCorridor = (s: BotWorldState | null | undefined) => s?.player?.worldX === 2998 && (s?.player?.worldZ ?? 0) >= 3917 && (s?.player?.worldZ ?? 0) <= 3930;

const chrome = await launchLabBrowser(bot, { headless });
const budget = setTimeout(() => {
    console.log(`RESULT budget {"error":"over ${arg('budget-s', '1500')} s"}`);
    void chrome.kill().then(() => process.exit(2));
}, Number(arg('budget-s', '1500')) * 1000);

const say = (line: string) => console.log(`TRACE ${line}`);

/** The SDK's [walkTo] lines (rs/485's 'sceneReady after N ticks' among them), kept per phase. */
const walkLines: string[] = [];
for (const level of ['log', 'warn', 'error'] as const) {
    const write = console[level].bind(console);
    console[level] = (...a: unknown[]) => {
        if (typeof a[0] === 'string' && a[0].startsWith('[walkTo]')) walkLines.push(a[0]);
        write(...a);
    };
}

function instrument(session: Session): void {
    const sdk = session.sdk;
    let last = '';
    sdk.onStateUpdate(s => {
        const d = s.dialog;
        const msgs = s.gameMessages.filter(m => m.tick === s.tick).map(m => m.text).join(' / ');
        const line = `at ${s.player?.worldX},${s.player?.worldZ} scene=${s.sceneReady ?? '?'} anim=${s.player?.animId} dialog ${d.isOpen ? 'open' : 'closed'}${msgs ? ` msg "${msgs}"` : ''}`;
        if (line !== last) say(`[${s.tick}] ${line}`);
        last = line;
    });
    const wrap = (name: 'sendInteractLoc' | 'sendWalk') => {
        const orig = (sdk[name] as (...a: unknown[]) => Promise<ActionResult>).bind(sdk);
        (sdk as unknown as Record<string, unknown>)[name] = async (...a: unknown[]) => {
            const t = sdk.getState()?.tick;
            const r = await orig(...a);
            say(`[${t}->${sdk.getState()?.tick}] ${name}(${a.map(x => String(x)).join(', ')}) -> ${r.success ? 'ok' : `FAIL ${r.reason ?? ''} ${r.message ?? ''}`}`);
            return r;
        };
    };
    wrap('sendInteractLoc');
    wrap('sendWalk');
}

/** A 52-Agility account with a knife and the HP to ignore the Wilderness's NPCs, standing on `at` with the region built. */
async function stage(session: Session, at: [number, number]): Promise<void> {
    const sdk = session.sdk;
    await setStats(sdk, { agility: 52, hitpoints: 70, defence: 70 });
    if (!sdk.getState()?.inventory.some(i => /^knife$/i.test(i.name))) {
        await clearInventory(sdk);
        await give(sdk, 'knife', 1);
    }
    await mustTele(sdk, at[0], at[1]);
    const r = await waitUntil(sdk, s => s.sceneReady !== false && s.nearbyLocs.length > 0, { maxTicks: 120 });
    if (!r.ok) throw new Error(`staging: the region at ${at.join(',')} never built (at ${JSON.stringify(pos(sdk))})`);
}

async function walkWilderness(session: Session): Promise<Record<string, unknown>> {
    const step = agilitySteps().find(st => st.name === 'agility:walk-wilderness')!;
    const log = TickLog.memory();
    let out: Record<string, unknown>;
    try {
        await runSteps(session, [step], { log, c: {}, shouldStop: () => false, logout: async () => {}, tickMonitor: false });
        out = { ok: true };
    } catch (e) {
        out = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    const s = session.sdk.getState();
    return { ...out, at: pos(session.sdk), inCourse: inWildCourse(s), rows: log.rows.map(r => ({ step: r.step, ok: r.ok, ticks: r.ticks, meta: r.meta, error: r.error })) };
}

const session = await openSession(bot, { client: 'browser', launch: true, insecureQueryLogin: true });
const sdk = session.sdk;
const page = (await chrome.browser.pages()).find(p => p.url().includes('/bot'));
let exit = 0;
try {
    // A fresh lab account starts on Tutorial Island: leave it before any ::tele (rs/233).
    await leaveTutorial(session);
    instrument(session);
    for (const phase of phases) {
        walkLines.length = 0;
        const t0 = sdk.getState()?.tick ?? 0;
        say(`=== phase ${phase} at tick ${t0}`);
        let out: Record<string, unknown> = {};
        try {
            if (phase === 'probe-walk') {
                await stage(session, LAST_LEG);
                const w = await session.bot.walkTo(RIDGE_GATE.approach[0], RIDGE_GATE.approach[1], 2, { timeout: 60_000 });
                // anything the walk set off (a ridge crossing, a fall) finishes within ~20 ticks
                await waitUntil(sdk, () => false, { maxTicks: 20 }).catch(() => undefined);
                out = { walk: w, at: pos(sdk), inCorridor: inCorridor(sdk.getState()), inCourse: inWildCourse(sdk.getState()) };
            } else if (phase === 'probe-corridor') {
                await stage(session, CORRIDOR);
                const r1 = await sdk.sendInteractLoc(RIDGE_GATE.x, RIDGE_GATE.z, RIDGE_GATE.id, 1);
                await waitUntil(sdk, s => inWildCourse(s) || !inCorridor(s), { maxTicks: 30 });
                const afterRidge = { click: r1, at: pos(sdk), inCorridor: inCorridor(sdk.getState()), inCourse: inWildCourse(sdk.getState()) };
                await stage(session, CORRIDOR);
                const r2 = await sdk.sendInteractLoc(COURSE_GATE.x, COURSE_GATE.z, COURSE_GATE.id, 1);
                await waitUntil(sdk, s => !inCorridor(s), { maxTicks: 60 });
                await waitUntil(sdk, () => false, { maxTicks: 4 }).catch(() => undefined);
                out = { ridgeGate: afterRidge, courseGate: { click: r2, at: pos(sdk), inCorridor: inCorridor(sdk.getState()), inCourse: inWildCourse(sdk.getState()) } };
            } else if (phase === 'north') {
                await stage(session, CORRIDOR);
                out = await walkWilderness(session);
                if (!out.inCourse) exit = 1;
            } else if (phase === 'pit') {
                await stage(session, PIT);
                out = await walkWilderness(session);
                if (!out.inCourse) exit = 1;
            } else if (phase === 'chain') {
                await stage(session, CHAIN_START);
                if (throttle !== null) await page?.emulateCPUThrottling(throttle);
                out = await walkWilderness(session);
                if (throttle !== null) await page?.emulateCPUThrottling(null);
                if (!out.inCourse) exit = 1;
            } else {
                throw new Error(`unknown phase ${phase}`);
            }
        } catch (e) {
            out = { error: e instanceof Error ? e.message : String(e), at: pos(sdk) };
            exit = 1;
        }
        result(phase, { ticks: (sdk.getState()?.tick ?? t0) - t0, ...out, sdkLines: walkLines.slice() });
    }
} finally {
    clearTimeout(budget);
    await logoutClean(session).catch(() => {});
    await closeSession(session).catch(() => {});
    await chrome.kill().catch(() => {});
}
process.exit(exit);
