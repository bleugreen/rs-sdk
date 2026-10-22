// Lab probe and acceptance for the Gnome Stronghold south gate on the browser client
// (cairn://p/rs/309): Femi's first-visit scene (femi.rs2 grandtree_femi_boxes, opened by the
// gate's oploc, gnome_gate.rs2) and clicks sent while the region is still loading.
//
//   NODE_TICKRATE=300 LAB_RUNNERS=0 speedrun/lab/lab.sh <fresh-bot> speedrun/lab/gnome-gate.ts:--phases=load,module,converse,advance
//
// The page must be this checkout's bundle (`bun run build` in server/webclient first). Chrome runs
// headless unless --headful. Each phase resets %femi_help to 0 and stands the player south of the
// gate, so every phase meets Femi's first-visit scene. Prints one RESULT line per phase and a
// TRACE of every published dialogue and scene change and every click with its result.
//
// Phases:
//   load      a long ::tele to the gate's south side, then a raw SDK gate click at once, under
//             'Loading - please wait' when the browser is still building the region
//   load-gate the same landing, then lib/travel.ts passGate at once
//   gate      a fresh first pass through passGate (Femi's scene cleared, ends north)
//   relog-gate  passGate straight after a relog
//   module    speedrun/skills/agility.ts's agility:walk-gnome from the gate's south side
//   module-east  the same from (2489,3389), the route point before the gate (the demo's approach)
//   converse  the gate clicked through act.ts actConverse (converse.ts's continue path)
//   advance   the gate clicked, then lib/dialogue.ts advance() page by page
import type { BotWorldState } from '../../sdk/types';
import { actConverse } from '../lib/act';
import { converse } from '../lib/converse';
import { advance } from '../lib/dialogue';
import { closeSession, openSession, relog, type Session } from '../lib/session';
import { GNOME_STRONGHOLD_GATE, passGate } from '../lib/travel';
import { TickLog } from '../lib/ticks';
import { waitUntil } from '../lib/wait';
import { pos } from '../lib/world';
import { runSteps } from '../runner/step';
import { steps as agilitySteps } from '../skills/agility';
import { launchLabBrowser } from './browser';
import { arg, botArg, result } from './common';
import { cheat, leaveTutorial, mustTele, setvar } from './setup';

const bot = botArg();
const phases = arg('phases', 'load,module,converse,advance').split(',');
const headless = !process.argv.includes('--headful');

/** The gate (gnome_areagate, loc 190) and its two entrances (gnome_gate.rs2: loc_coord + (2,-1) and + (2,2)). */
const GATE = { id: 190, x: 2459, z: 3383 };
const SOUTH: [number, number] = [2461, 3378];
const north = (s: BotWorldState | null | undefined) => (s?.player?.worldZ ?? 0) >= 3385 && (s?.player?.worldZ ?? 0) < 3400;

const chrome = await launchLabBrowser(bot, { headless });
const killBrowser = () => chrome.kill();
// The whole probe's budget (--budget-s, default 900): past it Chrome is killed and the probe fails.
const budget = setTimeout(() => {
    console.log(`RESULT budget {"error":"over ${arg('budget-s', '900')} s"}`);
    void killBrowser().then(() => process.exit(2));
}, Number(arg('budget-s', '900')) * 1000);

const trace: string[] = [];
const say = (line: string) => {
    trace.push(line);
    console.log(`TRACE ${line}`);
};

/** Log every change of position, scene readiness and dialogue page, and every click with its result. */
function instrument(session: Session): void {
    const sdk = session.sdk;
    let last = '';
    sdk.onStateUpdate(s => {
        const d = s.dialog;
        const dlg = d.isOpen ? `open${d.isWaiting ? ' waiting' : ''} page=${d.pageId ?? '-'} [${d.options.map(o => `${o.text}#${o.componentId ?? '?'}/${o.buttonType ?? '?'}`).join(' | ')}]` : 'closed';
        const line = `at ${s.player?.worldX},${s.player?.worldZ} scene=${s.sceneReady ?? '?'} dialog ${dlg}`;
        if (line !== last) say(`[${s.tick}] ${line}`);
        last = line;
    });
    const wrap = (name: 'sendInteractLoc' | 'sendClickDialog' | 'clickDialogByText' | 'sendWalk') => {
        const orig = (sdk[name] as (...a: unknown[]) => Promise<{ success: boolean; reason?: string; message?: string }>).bind(sdk);
        (sdk as unknown as Record<string, unknown>)[name] = async (...a: unknown[]) => {
            const t = sdk.getState()?.tick;
            const r = await orig(...a);
            say(`[${t}->${sdk.getState()?.tick}] ${name}(${a.map(x => String(x)).join(', ')}) -> ${r.success ? 'ok' : `FAIL ${r.reason ?? ''} ${r.message ?? ''}`}`);
            return r;
        };
    };
    wrap('sendInteractLoc');
    wrap('sendClickDialog');
    wrap('clickDialogByText');
    wrap('sendWalk');
}

/** Femi's first visit again, and the player standing south of the gate with the region built. */
async function stage(session: Session): Promise<void> {
    const sdk = session.sdk;
    // a page left open by an earlier phase (a choice page refuses a plain continue)
    if (sdk.getState()?.dialog.isOpen) await converse(sdk, [], { idle: 1, openTicks: 1, maxTicks: 60, unmatched: 'first' });
    await setvar(sdk, 'femi_help', 0);
    await mustTele(sdk, SOUTH[0], SOUTH[1]);
    const r = await waitUntil(sdk, s => s.sceneReady !== false && s.nearbyLocs.some(l => l.id === GATE.id) && s.nearbyNpcs.some(n => /femi/i.test(n.name)), { maxTicks: 120 });
    if (!r.ok) throw new Error(`staging: gate or Femi not in view at ${JSON.stringify(pos(sdk))}`);
}

const session = await openSession(bot, { client: 'browser', launch: true, insecureQueryLogin: true });
const sdk = session.sdk;
let exit = 0;
try {
    await leaveTutorial(session);
    instrument(session);
    for (const phase of phases) {
        const t0 = sdk.getState()?.tick ?? 0;
        say(`=== phase ${phase} at tick ${t0}`);
        let out: Record<string, unknown> = {};
        try {
            if (phase === 'load' || phase === 'load-gate') {
                // A long ::tele, then the gate click on the landing tick, under 'Loading - please wait'.
                // load: a raw SDK click (refused with scene_loading while the region loads, never ok).
                // load-gate: the shared helper at once (it waits for the region, clears Femi, ends north).
                await stage(session);
                await mustTele(sdk, 3222, 3218);
                await waitUntil(sdk, s => s.sceneReady !== false, { maxTicks: 120 });
                await cheat(sdk, `tele 0,${SOUTH[0] >> 6},${SOUTH[1] >> 6},${SOUTH[0] & 63},${SOUTH[1] & 63}`);
                const landed = await waitUntil(sdk, s => s.player?.worldX === SOUTH[0] && s.player?.worldZ === SOUTH[1], { maxTicks: 20 });
                const scene = sdk.getState()?.sceneReady;
                const clickTick = sdk.getState()?.tick ?? 0;
                let readyTick: number | null = null;
                const stop = sdk.onStateUpdate(s => {
                    if (readyTick === null && s.sceneReady !== false) readyTick = s.tick;
                });
                if (phase === 'load') {
                    const click = await sdk.sendInteractLoc(GATE.x, GATE.z, GATE.id, 1);
                    const outcome = await waitUntil(sdk, s => s.dialog.isOpen || north(s), { maxTicks: 40 });
                    out = { landed: landed.ok, sceneAtClick: scene, clickTick, click, readyTick, dialogOrThrough: outcome.ok, at: pos(sdk) };
                } else {
                    const g = await passGate(sdk, GNOME_STRONGHOLD_GATE, GNOME_STRONGHOLD_GATE.sides.north, { log: true });
                    out = { landed: landed.ok, sceneAtClick: scene, clickTick, readyTick, gate: g, north: north(sdk.getState()) };
                }
                stop();
            } else if (phase === 'gate' || phase === 'relog-gate') {
                // gate: a fresh first pass through the shared helper; relog-gate: the same straight after a relog
                await stage(session);
                let relogged: unknown = null;
                if (phase === 'relog-gate') {
                    const r = await relog(session, { offlineMs: 2_000 });
                    relogged = { loginTick: r.loginTick, via: r.via, sceneReady: sdk.getState()?.sceneReady, teleportTick: sdk.getState()?.player?.teleportTick, tick: sdk.getState()?.tick };
                }
                const g = await passGate(sdk, GNOME_STRONGHOLD_GATE, GNOME_STRONGHOLD_GATE.sides.north, { log: true });
                out = { relogged, gate: g, north: north(sdk.getState()) };
            } else if (phase === 'module' || phase === 'module-east') {
                await stage(session);
                // module-east: the demo's approach, the route point before the gate's south entrance
                if (phase === 'module-east') await mustTele(sdk, 2489, 3389);
                const step = agilitySteps({ to: 2 }).find(st => st.name === 'agility:walk-gnome')!;
                const log = TickLog.memory();
                try {
                    await runSteps(session, [step], { log, c: {}, shouldStop: () => false, logout: async () => {}, tickMonitor: false });
                    out = { ok: true };
                } catch (e) {
                    out = { ok: false, error: e instanceof Error ? e.message : String(e) };
                }
                out = { ...out, at: pos(sdk), north: north(sdk.getState()), rows: log.rows.map(r => ({ step: r.step, ok: r.ok, ticks: r.ticks, error: r.error })) };
            } else if (phase === 'converse') {
                await stage(session);
                const r = await actConverse(sdk, () => sdk.sendInteractLoc(GATE.x, GATE.z, GATE.id, 1), [/^Sorry, I'm a bit busy\.$/], { log: true, maxTicks: 60 });
                out = { ok: r.ok, reason: r.reason, pages: r.dialogue?.pages, options: r.dialogue?.options, transcript: r.dialogue?.transcript, at: pos(sdk) };
            } else if (phase === 'advance') {
                await stage(session);
                void sdk.sendInteractLoc(GATE.x, GATE.z, GATE.id, 1);
                const opened = await waitUntil(sdk, s => s.dialog.isOpen, { maxTicks: 20 });
                const steps: unknown[] = [];
                for (let k = 0; k < 10 && sdk.getState()?.dialog.isOpen; k++) {
                    const a = await advance(sdk, { choose: /^Sorry, I'm a bit busy\.$/, maxTicks: 6 });
                    steps.push(a);
                    if (!a.ok) break;
                }
                const closed = await waitUntil(sdk, s => !s.dialog.isOpen, { maxTicks: 10 });
                out = { opened: opened.ok, steps, closed: closed.ok, at: pos(sdk) };
            }
        } catch (e) {
            out = { error: e instanceof Error ? e.message : String(e), at: pos(sdk) };
            exit = 1;
        }
        result(phase, { ticks: (sdk.getState()?.tick ?? t0) - t0, ...out });
    }
} finally {
    clearTimeout(budget);
    await closeSession(session).catch(() => {});
    await killBrowser();
}
process.exit(exit);
