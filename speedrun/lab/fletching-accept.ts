// Lab acceptance for S18d-fallback (speedrun/skills/fletching.ts, STEP-MANIFEST.md entry 32): Fletching
// standalone through the page's item-cycle stack mode, in a browser tab (lite hosts no programs).
// Through lab.sh with LAB_RUNNERS=0 on its own port block, on bgsrv-mac or bgsrv-ub (never `local`,
// never fedora), the page this checkout's bundle (`bun run build` in server/webclient first):
//
//   NODE_TICKRATE=300 LAB_RUNNERS=0 WEB_PORT=9410 WEB_MANAGEMENT_PORT=9411 HISCORES_WEB_PORT=9412 \
//     NODE_PORT=44410 AGENT_PORT=8410 LAB_TIMEOUT=1500 \
//     speedrun/lab/lab.sh <lab-bot> speedrun/lab/fletching-accept.ts:today ...
//
// Chrome's DevTools port is WEB_PORT + 5 (lab/browser.ts). Staging (untimed) leaves Tutorial Island
// through S00's skip, empties the pack, sets Fletching and gives the case's stacks.
//
// cases:
//   today     Fletching 1 to 99 on today's 304-action stock (headless 4,560; bronze 60, iron 90, steel
//             135, mithril 1,485, adamant 2,220, rune 570 tips). Bar: 59 x 1.05 program ticks (entry 32).
//   fold19    the same on fold-in 19's 294-action stock (adamant 2,070, headless 4,410).
//   runelist  fletching.md's rune list (headless 3,600; mithril 225, adamant 495, rune 2,595): the route
//             delayfree-cycle.ts measures on lite, for the lite reference on the same route.
//   late      Fletching 97 holding 570 rune tips (the courier's late tier): the route to 99, then the
//             rune-only run, two program runs in the real page; 570 rune arrows at the end.
//   demo      a borrowed account's own headless arrows and bronze tips, bronze only, `--actions=N`
//             (default 100: 20 ticks), no keep, no staff commands. The tab is the host's own Chrome
//             (SPEEDRUN_CDP_URL), the gateway a loopback one. Before any click it waits up to
//             SCENE_TICKS for sceneReady and then for locs, and stops if either never shows.
//             Pass: 5 actions on >= 90% of work ticks.
// options: --log=<path>, --actions=N (demo)
// Prints one RESULT line: program ticks (first tick to done, the page's count, on observed ticks),
// the step's ticks (with the level-up clear), actions, the sends-per-tick histogram over ticks with
// work pending and the share at 5, overBudget, levels, rune arrows, the plan's figures and the verdict.

import { hostname, loadavg } from 'os';
import type { BotWorldState } from '../../sdk/types';
import { ARROW_TIERS, HEADLESS_ARROW } from '../lib/arrows';
import type { ItemCycleResult } from '../lib/item-cycle';
import { closeSession, logoutClean, openSession, type Session } from '../lib/session';
import { TickLog } from '../lib/ticks';
import { waitTicks, waitUntil } from '../lib/wait';
import { runSteps, type RunnerSession } from '../runner/step';
import { fletchingLevel, fletchingXp, planFletch, preconditions, runeArrowsOf, STEP_NAME, steps, stockOf, type FletchingOptions, type FletchRun } from '../skills/fletching';
import { launchLabBrowser, type LabBrowser } from './browser';
import { cheat, leaveTutorial, setstat } from './setup';

const bot = process.argv[2];
const which = process.argv[3];
const flag = (name: string, def?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const CASES = ['today', 'fold19', 'runelist', 'late', 'demo'] as const;
if (!bot || !which || !(CASES as readonly string[]).includes(which)) {
    console.error(`usage: bun speedrun/lab/fletching-accept.ts <bot> ${CASES.join('|')} [--actions=N] [--log=path]`);
    process.exit(2);
}

/** Entry 32: 1 to 99 within 5% of 59 ticks at 5 actions a tick. */
export const TARGET = 59;
export const BAR = TARGET * 1.05;
/** The demo's pass: 5 actions on at least 90% of the ticks with work pending. */
export const DEMO_SHARE = 0.9;
/**
 * The demo's bound on the region load before its first click: sceneReady, then the bank's locs. A cold
 * Chrome profile at Varrock west took about 75 ticks before locs appeared.
 */
export const SCENE_TICKS = 200;

const T = Object.fromEntries(ARROW_TIERS.map(t => [t.tier, t])) as Record<string, (typeof ARROW_TIERS)[number]>;
const TIPS = (o: Partial<Record<'bronze' | 'iron' | 'steel' | 'mithril' | 'adamant' | 'rune', number>>) => Object.entries(o).map(([t, n]) => [`${t}_arrowheads`, n] as const);

const STOCKS: Record<Exclude<(typeof CASES)[number], 'demo'>, { level: number; give: ReadonlyArray<readonly [string, number]> }> = {
    today: { level: 1, give: [['headless_arrow', 4560], ...TIPS({ bronze: 60, iron: 90, steel: 135, mithril: 1485, adamant: 2220, rune: 570 })] },
    fold19: { level: 1, give: [['headless_arrow', 4410], ...TIPS({ bronze: 60, iron: 90, steel: 135, mithril: 1485, adamant: 2070, rune: 570 })] },
    runelist: { level: 1, give: [['headless_arrow', 3600], ...TIPS({ bronze: 60, iron: 90, steel: 135, mithril: 225, adamant: 495, rune: 2595 })] },
    late: { level: 97, give: [['headless_arrow', 1200], ...TIPS({ adamant: 630, rune: 570 })] }
};

const where = () => ({ host: hostname(), load: loadavg().map(l => +l.toFixed(1)), at: new Date().toISOString() });

const browser: LabBrowser | null = which === 'demo' ? null : await launchLabBrowser(bot);
const opened: Session = await openSession(bot, { client: 'browser', launch: true, insecureQueryLogin: which !== 'demo' });
let exitCode = 0;
await (async () => {
    const sdk = opened.sdk;
    const session = opened as unknown as RunnerSession;
    const log = TickLog.open(undefined, flag('log'));
    const state = () => sdk.getState() as BotWorldState;
    const held = (id: number) => state().inventory.filter(i => i.id === id).reduce((n, i) => n + i.count, 0);
    let result: Record<string, unknown> = { case: which, bot, client: 'browser', ...where() };
    const runs: Array<{ run: FletchRun; result: ItemCycleResult }> = [];

    const stage = async (level: number, give: ReadonlyArray<readonly [string, number]>) => {
        for (let attempt = 1; ; attempt++) {
            try {
                await leaveTutorial(session, log);
                break;
            } catch (e) {
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
        await cheat(sdk, '~clearinv inv', 1);
        await cheat(sdk, '~clearinv worn', 1);
        await setstat(sdk, 'fletching', level);
        for (const [obj, n] of give) await cheat(sdk, `give ${obj} ${n}`);
        const ids = give.map(([obj]) => (obj === 'headless_arrow' ? HEADLESS_ARROW : T[obj.replace('_arrowheads', '')]!.tips));
        await waitUntil(sdk, s => ids.every(id => s.inventory.some(i => i.id === id && i.count > 0)), { maxTicks: 10 });
        await waitUntil(sdk, s => fletchingLevel(s) === level, { maxTicks: 5 });
        await waitTicks(sdk, 2);
    };

    const runStep = async (opts: FletchingOptions) => {
        const s = state();
        const plan = planFletch(stockOf(s), opts);
        const pre = preconditions(s, opts);
        console.log(`  preconditions: ${pre === true ? 'pass' : pre}; plan ${plan.actions} actions, ${plan.ticks} work ticks, runs ${plan.runs.map(r => `${r.kind}:${r.actions}`).join(' ')}`);
        result = { ...result, startLevel: fletchingLevel(s), startXp: fletchingXp(s), stock: stockOf(s), preconditions: pre, plan: { actions: plan.actions, ticks: plan.ticks, ceil5: Math.ceil(plan.actions / 5), runs: plan.runs.map(r => ({ kind: r.kind, actions: r.actions, ticks: r.ticks, byTier: r.byTier, maxActions: r.maxActions, untilLevel: r.untilLevel })), runeArrows: plan.runeArrows } };
        await runSteps(session, steps({ ...opts, onRun: (run, res) => runs.push({ run, result: res }), log: (m, d) => console.log(`  ${m}${d ? ` ${JSON.stringify(d).slice(0, 300)}` : ''}`) }), { log, c: {}, shouldStop: () => false, logout: async () => {}, tickMonitor: false });
    };

    const finish = (extra: Record<string, unknown> = {}) => {
        const stepRows = log.rows.filter(r => !r.kind && r.step === STEP_NAME);
        const programs = log.rows.filter(r => r.kind === 'program' && r.step === STEP_NAME);
        const programTicks = programs.reduce((n, r) => n + r.ticks, 0);
        const sends: Record<number, number> = {};
        for (const { result: r } of runs) for (const [k, n] of Object.entries(r.sendsPerTick)) sends[Number(k)] = (sends[Number(k)] ?? 0) + n;
        const pendingTicks = Object.values(sends).reduce((a, b) => a + b, 0);
        const at5 = sends[5] ?? 0;
        const overBudget = programs.reduce((n, r) => n + ((r.meta as { overBudget?: number }).overBudget ?? 0), 0);
        const s = state();
        const stepOk = stepRows.length > 0 && stepRows.every(r => r.ok);
        const verdict =
            which === 'demo'
                ? { pass: stepOk && pendingTicks > 0 && at5 / pendingTicks >= DEMO_SHARE, bar: `5 a tick on >= ${DEMO_SHARE * 100}% of work ticks` }
                : which === 'today' || which === 'fold19'
                  ? { pass: stepOk && fletchingLevel(s) >= 99 && runeArrowsOf(stockOf(s)) >= 570 && programTicks <= BAR, bar: `program ticks <= ${BAR.toFixed(2)} (59 + 5%)`, vs59: Math.round((programTicks / TARGET - 1) * 1000) / 10 }
                  : { pass: stepOk, bar: 'step ok (a reference case)' };
        result = {
            ...result,
            stepOk,
            programTicks,
            stepTicks: stepRows.reduce((n, r) => n + r.ticks, 0),
            programRuns: programs.map(r => ({ ok: r.ok, startTick: r.startTick, endTick: r.endTick, ticks: r.ticks, ...(r.error ? { error: r.error } : {}), overBudget: (r.meta as { overBudget?: number }).overBudget ?? 0 })),
            runs: runs.map(({ run, result: r }) => ({ kind: run.kind, planned: run.actions, landed: r.actions, sent: r.sent, ended: r.ended, ticks: r.ticks, levelups: r.levelups, byRecipe: r.byRecipe, sendsPerTick: r.sendsPerTick })),
            actions: runs.reduce((n, x) => n + x.result.actions, 0),
            sent: runs.reduce((n, x) => n + x.result.sent, 0),
            sendsPerTick: sends,
            workTicks: pendingTicks,
            shareAt5: pendingTicks ? Math.round((at5 / pendingTicks) * 1000) / 1000 : null,
            overBudget,
            endLevel: fletchingLevel(s),
            endXp: fletchingXp(s),
            runeArrows: runeArrowsOf(stockOf(s)),
            arrowsHeld: Object.fromEntries(ARROW_TIERS.map(t => [t.tier, held(t.arrow)])),
            tipsLeft: Object.fromEntries(ARROW_TIERS.map(t => [t.tier, held(t.tips)])),
            headlessLeft: held(HEADLESS_ARROW),
            groundArrows: s.groundItems.filter(g => ARROW_TIERS.some(t => t.arrow === g.id)).map(g => ({ id: g.id, count: g.count })),
            ...verdict,
            ...extra
        };
    };

    console.log(`fletching-accept ${which}: ${JSON.stringify(where())}`);
    try {
        if (which === 'demo') {
            // the account's own stacks; nothing staged
            await waitUntil(sdk, st => !!st.player && st.skills.length > 0, { maxTicks: 30 });
            // openSession does not wait for the region: a click before sceneReady may go unrouted, and a
            // bank with no locs has not loaded. Nothing is sent until both show; past the bound, stop.
            const t0 = state().tick;
            const ready = await waitUntil(sdk, st => st.sceneReady === true, { maxTicks: SCENE_TICKS });
            const locs = ready.ok ? await waitUntil(sdk, st => st.nearbyLocs.length > 0, { maxTicks: SCENE_TICKS - (ready.tick - t0) }) : null;
            result.scene = { sceneReadyTicks: ready.ok ? ready.tick - t0 : null, locsTicks: locs?.ok ? locs.tick - t0 : null, locs: state().nearbyLocs.length, at: [state().player?.worldX, state().player?.worldZ] };
            if (!ready.ok) throw new Error(`sceneReady not true within ${SCENE_TICKS} ticks (${ready.reason}): stopped before any click`);
            if (!locs!.ok) throw new Error(`0 locs within ${SCENE_TICKS} ticks of the first state (${locs!.reason}): stopped before any click`);
            const s = state();
            const n = Math.min(held(HEADLESS_ARROW), held(T.bronze!.tips));
            const actions = Math.min(Number(flag('actions', '100')), Math.floor(n / 15));
            if (actions <= 0) throw new Error(`the account holds ${held(HEADLESS_ARROW)} headless arrows and ${held(T.bronze!.tips)} bronze tips: nothing to fletch`);
            result.account = { fletching: fletchingLevel(s), xp: fletchingXp(s), at: [s.player?.worldX, s.player?.worldZ], inventory: s.inventory.map(i => ({ slot: i.slot, id: i.id, name: i.name, count: i.count })) };
            await runStep({ tiers: ['bronze'], maxActions: actions, keepRune: 0 });
        } else {
            const st = STOCKS[which as keyof typeof STOCKS];
            await stage(st.level, st.give);
            await runStep({});
        }
        finish();
    } catch (e) {
        exitCode = 1;
        finish({ error: e instanceof Error ? e.message : String(e) });
    } finally {
        console.log(`RESULT ${JSON.stringify({ ...result, log: log.path })}`);
        const out = await logoutClean(opened).catch(e => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
        console.log(`LOGOUT ${JSON.stringify(out)}`);
        await closeSession(opened).catch(() => {});
        await browser?.kill().catch(() => {});
    }
})();
process.exit(exitCode);
