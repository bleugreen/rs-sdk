// Lab check for sdk walkStepToward's scene_loading wait: a bot.walkTo that starts while the browser
// client rebuilds the region (state.sceneReady false) must wait for the build and re-send its walk,
// not end in "Stuck at". The case is S06's entry: the real T05-06 leg (Falador teleport, run, air
// talisman on the ruins, runner/legs.ts runLeg) lands in the air altar room, and the step's own
// entry walk (skills/runecraft.ts enter: bot.walkTo to the stand tile, tolerance 0) starts on the
// landing's first published state, before the room's region is built.
//
//   NODE_TICKRATE=400 LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> speedrun/lab/walk-scene-loading.ts[:runs]
//
// The tab is the lab's /bot page in headless Chrome (lab/browser.ts): `bun run build` in
// server/webclient first. One `RESULT walk {...}` line per run: sceneReady when the walk starts, the
// tick the region was built, every sendWalk (tick from the walk's start, sceneReady, its reason), the
// walk's result and ticks, and the SDK's [walkTo] lines. `RESULT stalls {...}`: the widest wall-clock
// gaps between consecutive observed ticks, so a host stall is visible beside the tick counts.
import type { ActionResult } from '../../sdk/types';
import { closeSession, logoutClean, openSession } from '../lib/session';
import { waitUntil } from '../lib/wait';
import { legById, runLeg } from '../runner/legs';
import { ALTAR_ROOMS } from '../skills/runecraft';
import { launchLabBrowser } from './browser';
import { clearInventory, give, leaveTutorial, mustTele, setStats } from './setup';

const botName = process.argv[2];
if (!botName) throw new Error('usage: walk-scene-loading.ts <bot> [runs]');
const runs = Number(process.argv[3] ?? 3);
const result = (name: string, v: unknown) => console.log(`RESULT ${name} ${JSON.stringify(v)}`);

const chrome = await launchLabBrowser(botName);
const session = await openSession(botName, { client: 'browser', launch: true, insecureQueryLogin: true });
const { sdk, bot } = session;

// Wall ms between consecutive observed ticks.
let lastTick = -1;
let lastWall = 0;
const gaps: Array<{ tick: number; ms: number }> = [];
sdk.onStateUpdate(s => {
    if (s.tick === lastTick) return;
    const now = Date.now();
    if (lastTick >= 0) gaps.push({ tick: s.tick, ms: now - lastWall });
    lastTick = s.tick;
    lastWall = now;
});

// Every walk dispatch, and the SDK's [walkTo] lines, during the measured walk.
const sends: Array<{ tick: number; sceneReady: boolean | undefined; reason: string }> = [];
const sendWalk = sdk.sendWalk.bind(sdk);
sdk.sendWalk = async (x: number, z: number, running?: boolean): Promise<ActionResult> => {
    const s = sdk.getState();
    const r = await sendWalk(x, z, running);
    sends.push({ tick: s?.tick ?? -1, sceneReady: s?.sceneReady, reason: r.reason ?? (r.success ? 'ok' : 'failed') });
    return r;
};
const walkLines: string[] = [];
for (const level of ['log', 'warn'] as const) {
    const write = console[level].bind(console);
    console[level] = (...a: unknown[]) => {
        if (typeof a[0] === 'string' && a[0].startsWith('[walkTo]')) walkLines.push(a[0]);
        write(...a);
    };
}

const leg = legById('T05-06');
const stand = ALTAR_ROOMS.air.stand!;
let exit = 0;
try {
    await leaveTutorial(session);
    for (let run = 0; run < runs; run++) {
        // Untimed staging at the leg's start: Magic 37 and the Falador teleport's runes, the talisman.
        await clearInventory(sdk);
        await setStats(sdk, { magic: 37, runecraft: 1 });
        for (const [obj, n] of [['air_talisman', 1], ['lawrune', 1], ['airrune', 3], ['waterrune', 1]] as const) await give(sdk, obj, n);
        await mustTele(sdk, leg.def.start.x, leg.def.start.z);
        await waitUntil(sdk, st => st.sceneReady !== false && st.nearbyLocs.length > 0, { maxTicks: 200 });

        const legRun = await runLeg(leg.def, { sdk, bot });
        const s0 = sdk.getState()!;
        sends.length = 0;
        walkLines.length = 0;
        let builtTick: number | null = s0.sceneReady !== false ? s0.tick : null;
        const unsub = sdk.onStateUpdate(s => { if (builtTick === null && s.sceneReady !== false) builtTick = s.tick; });
        const w = await bot.walkTo(stand.x, stand.z, 0);
        unsub();
        const s1 = sdk.getState()!;
        const onStand = s1.player?.worldX === stand.x && s1.player?.worldZ === stand.z;
        if (!w.success || !onStand) exit = 1;
        result('walk', {
            run,
            legTicks: legRun?.ticks ?? null,
            from: { x: s0.player?.worldX, z: s0.player?.worldZ },
            to: stand,
            sceneReadyAtStart: s0.sceneReady,
            builtAfterTicks: builtTick === null ? null : builtTick - s0.tick,
            sends: sends.map(x => ({ ...x, tick: x.tick - s0.tick })),
            walk: w,
            walkTicks: s1.tick - s0.tick,
            onStand,
            sdkLines: walkLines.slice()
        });
    }
} catch (e) {
    exit = 1;
    console.error(`walk-scene-loading failed: ${e instanceof Error ? e.message : String(e)}`);
} finally {
    const top = [...gaps].sort((a, b) => b.ms - a.ms).slice(0, 5);
    const mean = gaps.length ? Math.round(gaps.reduce((n, g) => n + g.ms, 0) / gaps.length) : null;
    result('stalls', { tickMs: Number(process.env.NODE_TICKRATE ?? 0), ticks: gaps.length, meanMs: mean, widest: top });
    await logoutClean(session).catch(() => {});
    await closeSession(session).catch(() => {});
    await chrome.kill().catch(() => {});
}
process.exit(exit);
