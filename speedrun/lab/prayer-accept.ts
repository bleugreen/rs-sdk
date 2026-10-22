// Lab acceptance for S25b's booth fallback (speedrun/skills/prayer.ts, STEP-MANIFEST.md entry 15):
// dragon bones buried at the Varrock west booth through runSteps, against 58 ticks per 28-bone
// inventory + 5% (60.9). Through lab.sh on the prayer port block (prayer-lab.sh's), on bgsrv-mac or
// bgsrv-ub, never `local`, and not fedora (its engine stalls 14-40 s):
//
//   lite:     NODE_TICKRATE=300 WEB_PORT=9230 WEB_MANAGEMENT_PORT=9231 HISCORES_WEB_PORT=9232 NODE_PORT=43930 \
//               AGENT_PORT=8130 LAB_TIMEOUT=1500 speedrun/lab/lab.sh <bot> speedrun/lab/prayer-accept.ts:inv5
//   browser:  (cd server/webclient && bun run build), then the same with LAB_RUNNERS=0 and
//               speedrun/lab/prayer-accept.ts:inv5:--client=browser (or cold:--client=browser)
//
// Chrome's DevTools port is WEB_PORT + 7. Staging leaves Tutorial Island through S00's tutorialSkip
// (setup.ts leaveTutorial, rs/284) before any teleport, then empties the pack and bank, sets
// Prayer 1 and banks the bones at the booth as a helper's noted stack would be (the deposit is
// staging, not measured).
//
// cases:
//   inv5  5 inventories: 140 dragon bones banked, the step from (3185,3436) with the bank closed.
//         Pass: 5 full-load cycles (bank open to bank open), each <= 60.9.
//   cold  start on arrival: 56 banked, then ::tele to Varrock east bank and walk in to (3185,3436),
//         the step at once (a cold region: the booth clicked right after the walk). Pass: both
//         full-load cycles <= 60.9 and the first visit's bank open within 3 ticks of the step's start.
// options: --client=lite|browser (default lite), --bones=N (overrides the case's count), --log=path
// Prints one RESULT line: the module's BoothReport (on observed ticks), the verdict, host and load.

import { hostname, loadavg } from 'os';
import type { BotWorldState } from '../../sdk/types';
import { depositAll } from '../lib/bank';
import { closeSession, logoutClean, openSession, type Session } from '../lib/session';
import { TickLog } from '../lib/ticks';
import { waitTicks, waitUntil } from '../lib/wait';
import { runSteps, type RunnerSession } from '../runner/step';
import { boothFor, SCORED_TILE, VARROCK_WEST } from '../skills/herblore';
import { preconditions, prayerOf, steps, STEP_NAME, type BoothReport } from '../skills/prayer';
import { launchLabBrowser, type LabBrowser } from './browser';
import { cheat, leaveTutorial, mustTele, near, setstat } from './setup';

const bot = process.argv[2];
const which = process.argv[3];
const flag = (name: string, def?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const CASES = ['inv5', 'cold'];
if (!bot || !which || !CASES.includes(which)) {
    console.error(`usage: bun speedrun/lab/prayer-accept.ts <bot> ${CASES.join('|')} [--client=lite|browser] [--bones=N] [--log=path]`);
    process.exit(2);
}
const client = flag('client', 'lite');
if (client !== 'lite' && client !== 'browser') throw new Error('--client must be lite or browser');

/** prayer.md section 1: 58 ticks per 28-bone inventory, measured; the bar is +5%. */
export const CYCLE = 58;
export const BAR = CYCLE * 1.05;
const VARROCK_EAST_BANK = { x: 3253, z: 3420 };
const bones = Number(flag('bones', which === 'inv5' ? '140' : '56'));
const wantCycles = Math.floor(bones / 28);
const where = () => ({ host: hostname(), load: loadavg().map(l => +l.toFixed(1)), at: new Date().toISOString() });

const chrome: LabBrowser | null = client === 'browser' ? await launchLabBrowser(bot, { cdpPort: Number(process.env.WEB_PORT ?? '9300') + 7 }) : null;

const opened: Session = await openSession(bot, client === 'browser' ? { client: 'browser', launch: true, insecureQueryLogin: true } : {});
let exitCode = 0;
const result: Record<string, unknown> = { case: which, client, bot, bones, bar: BAR };
await (async () => {
    const sdk = opened.sdk;
    const actions = opened.bot;
    const session = opened as unknown as RunnerSession;
    const log = TickLog.open(undefined, flag('log'));
    const state = () => sdk.getState() as BotWorldState;
    const boothInView = (s: BotWorldState) => s.nearbyLocs.some(l => l.id === VARROCK_WEST.id && l.x === VARROCK_WEST.x && l.z === VARROCK_WEST.z);

    /** A clean lab start at the booth: off the island, empty pack and bank, Prayer 1, `n` dragon bones banked. */
    const stage = async (n: number) => {
        for (let attempt = 1; ; attempt++) {
            try {
                await leaveTutorial(session, log);
                break;
            } catch (e) {
                // S00 in a fresh tab is occasionally slow to get the guide's first page (LAB.md): a staging retry, not measured
                if (attempt >= 3) throw e;
                console.log(`  tutorial skip attempt ${attempt}: ${e instanceof Error ? e.message : String(e)}; again`);
                await sdk.sendCloseModal().catch(() => {});
                await waitTicks(sdk, 3);
            }
        }
        while (state().dialog.isOpen) {
            await sdk.sendClickDialog(0);
            await waitTicks(sdk, 1);
        }
        await mustTele(sdk, SCORED_TILE.x, SCORED_TILE.z);
        await cheat(sdk, '~clearinv inv', 1);
        await cheat(sdk, '~clearinv bank', 1);
        await setstat(sdk, 'prayer', 1);
        await setstat(sdk, 'hitpoints', 99);
        await waitUntil(sdk, boothInView, { maxTicks: 20 });
        await cheat(sdk, `give cert_dragon_bones ${n}`);
        if (!(await waitUntil(sdk, s => s.inventory.some(i => i.id === 537 && i.count >= n), { maxTicks: 10 })).ok) throw new Error('staging: the noted bones did not arrive');
        const booth = boothFor(state());
        await sdk.sendInteractLoc(booth.x, booth.z, booth.id, booth.option);
        if (!(await waitUntil(sdk, s => s.bank.isOpen, { maxTicks: 10 })).ok) throw new Error('staging: the bank did not open');
        const dep = await depositAll(sdk);
        if (!dep.ok) throw new Error(`staging: deposit ${dep.reason}`);
        if (state().bank.noteMode) await sdk.sendClickComponent(5387);
        await waitUntil(sdk, s => s.bank.items.some(i => i.id === 536 && i.count === n) && !s.bank.noteMode, { maxTicks: 6 });
        await sdk.sendCloseModal();
        await waitUntil(sdk, s => !s.bank.isOpen, { maxTicks: 6 });
        await waitTicks(sdk, 2);
        if (prayerOf(state()).level !== 1) throw new Error(`staging: Prayer ${prayerOf(state()).level}, not 1`);
    };

    console.log(`prayer-accept ${which} (${client}): ${JSON.stringify(where())}`);
    try {
        await stage(bones);
        if (which === 'cold') {
            await mustTele(sdk, VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z);
            const w = await actions.walkTo(SCORED_TILE.x, SCORED_TILE.z, 0);
            if (!near(state(), SCORED_TILE.x, SCORED_TILE.z)) throw new Error(`the walk in did not reach ${SCORED_TILE.x},${SCORED_TILE.z}: ${JSON.stringify(w)}`);
            result.arrivedTick = state().tick;
            result.boothInViewOnArrival = boothInView(state());
        }
        const pre = preconditions(state());
        result.preconditions = pre;
        console.log(`  preconditions: ${pre === true ? 'pass' : pre}`);
        await runSteps(session, steps(), { log, c: {}, shouldStop: () => false, logout: async () => {}, tickMonitor: false });
        const row = log.rows.find(r => !r.kind && r.step === STEP_NAME);
        const rep = log.rows.find(r => r.kind === 'note' && r.step === 'S25b:booth')?.meta as unknown as BoothReport | undefined;
        if (!rep) throw new Error('no S25b:booth report in the log');
        const xpGaps = rep.xpTicks.slice(1).map((t, i) => t - rep.xpTicks[i]!);
        const hist = (xs: number[]) => xs.reduce<Record<number, number>>((h, x) => ((h[x] = (h[x] ?? 0) + 1), h), {});
        const firstOpen = rep.bankOpens.length ? rep.bankOpens[0]! - rep.startTick : null;
        const cyclesOk = rep.fullCycles.length >= wantCycles && rep.fullCycles.every(c => c <= BAR);
        const pass = !!row?.ok && rep.buried === bones && cyclesOk && (which !== 'cold' || (firstOpen !== null && firstOpen <= 3));
        Object.assign(result, {
            pass,
            stepTicks: row?.ticks ?? null,
            ticksPerInventoryOverall: row ? Math.round((row.ticks / (bones / 28)) * 100) / 100 : null,
            fullCycles: rep.fullCycles,
            ticksPerInventory: rep.ticksPerInventory,
            worstCycle: Math.max(0, ...rep.fullCycles),
            firstOpenTicks: firstOpen,
            buried: rep.buried,
            loads: rep.loads,
            xpGapHistogram: hist(xpGaps),
            clicks: rep.clicks,
            boothClicks: rep.boothClicks,
            levelUps: rep.levelUps,
            eventPeak: rep.eventPeak,
            level: rep.level,
            stop: rep.stop
        });
        if (!pass) exitCode = 1;
    } catch (e) {
        exitCode = 1;
        result.error = e instanceof Error ? e.message : String(e);
    } finally {
        console.log(`RESULT ${JSON.stringify({ ...result, ...where(), log: log.path })}`);
        const out = await logoutClean(opened).catch(e => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
        console.log(`LOGOUT ${JSON.stringify(out)}`);
        await closeSession(opened).catch(() => {});
        await chrome?.kill().catch(() => {});
    }
})();
process.exit(exitCode);
