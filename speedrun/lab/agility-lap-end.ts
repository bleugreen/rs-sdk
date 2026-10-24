// Lab acceptance for the Agility band's lap-boundary end (cairn://p/rs/682): an untilLevel band ends
// only once the lap closes on the ground, so the next leg can leave from where it stops. Tonight's
// S11a stopped on the rope's landing, (2483,3420) on plane 2, and T11a could not leave from there.
//
//   NODE_TICKRATE=400 SPEEDRUN_TICK_MS=400 LAB_RUNNERS=0 LAB_TIMEOUT=1500 \
//     speedrun/lab/lab.sh <bot> 'speedrun/lab/agility-lap-end.ts:--phases=lap,resume,old'
//
// The page must be this checkout's bundle (`bun run build` in server/webclient first). Setup is
// untimed (::setstat, ::~addxp, ::tele). Phases, each followed by T11a through the run's own leg:
//   lap     Agility 24 with `--short` published xp left to 25 (default 600: the lap's first three
//           obstacles publish 500 at 25 per base xp, the rope makes 687.5), from the course start; the
//           S11a band step (speedrun/skills/agility.ts, to 25) as the run calls it
//   resume  Agility 25 already, standing on the rope's landing on plane 2: the band step resumes
//           partway round and finishes the lap
//   old     the program as before (untilLevel only) from the same setup as `lap`: where it stops,
//           and whether T11a leaves from there (bounded at --old-leg-ticks, default 150)
// Prints a TRACE line per change of tile, plane, level or xp, and one RESULT line per phase.
import type { BotWorldState } from '../../sdk/types';
import { programStatus, runProgram } from '../lib/programs';
import { closeSession, openSession, type Session } from '../lib/session';
import { TickLog } from '../lib/ticks';
import { waitTicks, waitUntil } from '../lib/wait';
import { legById } from '../runner/legs';
import { runSteps, type Step } from '../runner/step';
import { agilityLevel, GNOME_START, midLap, steps as agilitySteps } from '../skills/agility';
import { launchLabBrowser } from './browser';
import { arg, botArg, result } from './common';
import { cheat, leaveTutorial, mustTele, setstat } from './setup';

const bot = botArg();
const phases = arg('phases', 'lap,resume,old').split(',');
const short = Number(arg('short', '600'));
const oldLegTicks = Number(arg('old-leg-ticks', '150'));
const TO = 25;

const chrome = await launchLabBrowser(bot, { headless: !process.argv.includes('--headful') });
const budget = setTimeout(() => {
    console.log(`RESULT budget {"error":"over ${arg('budget-s', '1200')} s"}`);
    void chrome.kill().then(() => process.exit(2));
}, Number(arg('budget-s', '1200')) * 1000);

const xpOf = (s: BotWorldState | null | undefined) => s?.skills?.find(k => k.name.toLowerCase() === 'agility')?.experience ?? 0;
const where = (s: BotWorldState | null | undefined) => ({ x: s?.player?.worldX, z: s?.player?.worldZ, plane: s?.player?.level });

interface Row { tick: number; x: number; z: number; plane: number; level: number; xp: number }

/** Every change of tile, plane, level or xp from now on. */
function trace(session: Session): { rows: Row[]; stop: () => void } {
    const rows: Row[] = [];
    let last = '';
    const stop = session.sdk.onStateUpdate(s => {
        const p = s.player;
        if (!p) return;
        const r: Row = { tick: s.tick, x: p.worldX, z: p.worldZ, plane: p.level, level: agilityLevel(s), xp: xpOf(s) };
        const key = `${r.x},${r.z},${r.plane},${r.level},${r.xp}`;
        if (key === last) return;
        last = key;
        rows.push(r);
        console.log(`TRACE [${r.tick}] (${r.x},${r.z}) plane ${r.plane} agility ${r.level} xp ${r.xp}`);
    });
    return { rows, stop };
}

/** The level tick, the xp drops after it (the obstacles finished to close the lap) and where it ended. */
function summarise(rows: Row[]) {
    const at = rows.find(r => r.level >= TO);
    const after = at ? rows.filter((r, i) => r.tick > at.tick && i > 0 && r.xp > rows[i - 1]!.xp) : [];
    return {
        levelTick: at?.tick ?? null,
        levelTile: at ? { x: at.x, z: at.z, plane: at.plane } : null,
        dropsAfterLevel: after.map(r => ({ tick: r.tick, x: r.x, z: r.z, plane: r.plane, gain: Math.round(((r.xp - rows[rows.indexOf(r) - 1]!.xp) / 25) * 10) / 10 }))
    };
}

async function stepRun(session: Session, step: Step): Promise<{ ok: boolean; ticks: number | null; error?: string; rows: unknown[] }> {
    const log = TickLog.memory();
    try {
        await runSteps(session, [step], { log, c: {}, shouldStop: () => false, logout: async () => {}, tickMonitor: false });
        const row = log.rows.find(r => r.step === step.name);
        return { ok: true, ticks: row?.ticks ?? null, rows: log.rows.map(r => ({ step: r.step, ok: r.ok, ticks: r.ticks, meta: r.meta })) };
    } catch (e) {
        return { ok: false, ticks: null, error: e instanceof Error ? e.message : String(e), rows: log.rows.map(r => ({ step: r.step, ok: r.ok, ticks: r.ticks, error: r.error })) };
    }
}

/** Agility 24 with `remaining` game xp to 25 (or 25 when null), standing on (x, z, plane) with the scene built. */
async function stage(session: Session, remaining: number | null, at: [number, number, number]): Promise<Record<string, unknown>> {
    const sdk = session.sdk;
    // 25's threshold as this engine publishes it (::setstat sets a level's first xp; the published
    // unit is not the xp table's), then 24 for a staged approach
    await setstat(sdk, 'agility', TO);
    await waitUntil(sdk, s => agilityLevel(s) === TO, { maxTicks: 10 });
    await waitTicks(sdk, 1);
    const XP_25 = xpOf(sdk.getState());
    if (remaining !== null) {
        await setstat(sdk, 'agility', TO - 1);
        await waitUntil(sdk, s => agilityLevel(s) === TO - 1, { maxTicks: 10 });
    }
    let unit: number | null = null;
    if (remaining !== null) {
        // ::~addxp pays at the engine's xp rate: measure one unit, then add the rest
        const x0 = xpOf(sdk.getState());
        await cheat(sdk, '~addxp agility 1');
        await waitUntil(sdk, s => xpOf(s) > x0, { maxTicks: 10 });
        unit = xpOf(sdk.getState()) - x0;
        const k = Math.floor((XP_25 - remaining - xpOf(sdk.getState())) / unit);
        if (k > 0) {
            const x1 = xpOf(sdk.getState());
            await cheat(sdk, `~addxp agility ${k}`);
            await waitUntil(sdk, s => xpOf(s) > x1, { maxTicks: 10 });
        }
    }
    await mustTele(sdk, at[0], at[1], at[2]);
    if (sdk.getState()?.dialog.isOpen) await sdk.sendClickDialog(0);
    await waitUntil(sdk, s => s.sceneReady !== false && s.nearbyLocs.length > 0, { maxTicks: 60 });
    await waitTicks(sdk, 2);
    const s = sdk.getState();
    return { level: agilityLevel(s), xp: xpOf(s), xp25: XP_25, toLevel: XP_25 - xpOf(s), addxpUnit: unit, at: where(s) };
}

const session = await openSession(bot, { client: 'browser', launch: true, insecureQueryLogin: true });
const sdk = session.sdk;
const band = agilitySteps({ to: TO }).find(s => s.name === 'agility:gnome')!;
const t11a = legById('T11a');
let exit = 0;
try {
    await leaveTutorial(session);
    for (const phase of phases) {
        let out: Record<string, unknown> = {};
        try {
            if (phase === 'lap' || phase === 'resume') {
                const setup = phase === 'lap' ? await stage(session, short, [GNOME_START[0], GNOME_START[1], 0]) : await stage(session, null, [2483, 3420, 2]);
                const s0 = sdk.getState()!;
                const observed = { state: s0, probed: {} };
                const before = { done: band.done!(observed, {}), inProgress: band.inProgress!(observed, {}), midLap: midLap('gnome', s0) };
                const tr = trace(session);
                const b = await stepRun(session, band);
                tr.stop();
                const end = sdk.getState()!;
                const program = programStatus(end);
                const res = (program?.result ?? {}) as { ended?: string; afterLevel?: { ticks: number; obstacles: number }; levelTicks?: Record<string, number>; laps?: number };
                const after = { done: band.done!({ state: end, probed: {} }, {}), midLap: midLap('gnome', end), post: band.postconditions(end, {}) };
                const leg = await stepRun(session, t11a);
                out = {
                    setup, before, band: { ok: b.ok, ticks: b.ticks, error: b.error, rows: b.rows }, program: { ended: res.ended, endedTick: program?.endedTick, laps: res.laps, levelTicks: res.levelTicks, afterLevel: res.afterLevel },
                    ...summarise(tr.rows), endTile: where(end), after, t11a: { ok: leg.ok, ticks: leg.ticks, error: leg.error, at: where(sdk.getState()) }
                };
                if (!b.ok || !leg.ok || end.player?.level !== 0 || after.midLap) exit = 1;
            } else if (phase === 'old') {
                const setup = await stage(session, short, [GNOME_START[0], GNOME_START[1], 0]);
                const tr = trace(session);
                const st = await runProgram(sdk, 'agility', { course: 'gnome', untilLevel: TO, startStep: 'auto', stepTimeout: 40 });
                tr.stop();
                const end = sdk.getState()!;
                const t0 = end.tick;
                const leg = await Promise.race([
                    stepRun(session, t11a),
                    waitUntil(sdk, s => s.tick - t0 >= oldLegTicks, { maxTicks: oldLegTicks + 10 }).then(() => ({ ok: false, ticks: null, error: `not arrived after ${oldLegTicks} ticks`, rows: [] }))
                ]);
                out = { setup, program: { phase: st.phase, ended: (st.result as { ended?: string })?.ended, endedTick: st.endedTick }, ...summarise(tr.rows), endTile: where(end), t11a: { ok: leg.ok, ticks: leg.ticks, error: leg.error, at: where(sdk.getState()) } };
                // back on the ground for whatever runs next
                await mustTele(sdk, GNOME_START[0], GNOME_START[1], 0);
            }
        } catch (e) {
            out = { error: e instanceof Error ? e.message : String(e), at: where(sdk.getState()) };
            exit = 1;
        }
        result(phase, out);
    }
} finally {
    clearTimeout(budget);
    await closeSession(session).catch(() => {});
    await chrome.kill();
}
process.exit(exit);
