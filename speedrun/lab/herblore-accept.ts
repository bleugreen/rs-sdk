// Lab acceptance for S25e (speedrun/skills/herblore.ts, STEP-MANIFEST.md entry 27) in a browser
// tab this script opens (lib/session openSession, as runecraft-accept.ts does; lite hosts no
// programs), so L5 can log the tab out and back in. Through lab.sh on port block 12 (LAB.md),
// which starts the engine and gateway and refuses an engine that did not bind:
//
//   (cd server/webclient && bun run build)
//   NODE_TICKRATE=300 LAB_RUNNERS=0 WEB_PORT=9020 WEB_MANAGEMENT_PORT=9021 HISCORES_WEB_PORT=9022 \
//     NODE_PORT=43720 AGENT_PORT=7920 LAB_TIMEOUT=2700 \
//     speedrun/lab/lab.sh <lab-bot> speedrun/lab/herblore-accept.ts:l1 speedrun/lab/herblore-accept.ts:l2 ...
//
// Chrome's DevTools port is WEB_PORT + 7 (9027 on block 12). --headless for a runner without a display.
//
// cases (each empties the bot's bank and inventory first; staging leaves Tutorial Island through
// S00's tutorialSkip, setup.ts leaveTutorial):
//   l1    S25e's real preconditions: Herblore 28, the supply-safe list (guam unf 41, irit unf 405,
//         eye of newt 432) held as banknotes, as H21e delivers it. Cold arrival: ::tele to Varrock
//         east bank, then walk in to (3185,3436), so the first booth click lands on a freshly
//         loaded region. Pass: 99, ticks <= 178 (170 + 5%).
//   l2    a ::setstat account: Herblore 28, the ranging-cap list (herblore.md section 7) banked
//         unnoted before the step. Pass: ticks <= 123 (117 + 5%).
//   l3    the staged H21e stock (SUPPLIES.md H21e: rs/323's 09:10Z count across seven helpers plus
//         cairn_h96's 100 snape grass: guam 298, tarromin 166, ranarr 115, irit 74, avantoe 53, kwuarm
//         45 unf; eye of newt 418, limpwurt 250, snape grass 190) held as notes: the step's
//         precondition text, then the program to 99 (or `out of supplies`). Pass: program ticks
//         within 5% of planRoute's expectedTicks.
//   l4    the in-page side of the overlay comparison: Herblore 66, superdefence + ranging (the
//         list delayfree-cycle.ts gives itself), to 99. Run delayfree-cycle.ts --skill=herblore
//         --route=superdefence,ranging --level=66 as the next spec for the overlay side.
//   l5    resume: l1's list, a clean logout (logoutClean) once Herblore passes --relog-at (default
//         50), then login, resolveResume and the step's resume.
//   demo  entry 27's demo on a borrowed account (cairn_h85, Herblore 63, its own guam unf and eye of
//         newt banked): recipes ['attack'], maxActions 28, at the booth in view (waited for, up
//         to 60 ticks after the login), standing where one routed open of it ends; its inventory
//         is banked by the program and put back afterwards, emptied if it started empty. No
//         staff commands.
// options: --to=99, --relog-at=50, --log=<path>
// Prints one RESULT line per case: ticks, the pass bound, the cycle-gap histogram, the level-up
// backlog, and the per-tick sends and landings the demo metric reads.

import { hostname, loadavg } from 'os';
import { join } from 'path';
import type { BotWorldState } from '../../sdk/types';
import { itemCycleShared, planRoute, runItemCycle, stockFrom, type ItemCycleShared } from '../lib/item-cycle';
import { programStatus } from '../lib/programs';
import { closeSession, login, logoutClean, openSession, type Session } from '../lib/session';
import { TickLog } from '../lib/ticks';
import { waitTicks, waitUntil } from '../lib/wait';
import { levelForXp, xpForLevel } from '../lib/xp';
import { Observation, resolveResume } from '../runner/resume';
import { runSteps, type RunnerSession } from '../runner/step';
import { boothFor, HERB_NOTES, herbloreLevel, herbloreXp, POST_RITUAL_XP, preconditions, recipesFor, SCORED_TILE, STEP_NAME, steps, VARROCK_WEST } from '../skills/herblore';
import { launchLabBrowser, type LabBrowser } from './browser';
import { cheat, leaveTutorial, mustTele, near, setstat } from './setup';

const bot = process.argv[2];
const which = process.argv[3];
const flag = (name: string, def?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const CASES = ['l1', 'l2', 'l3', 'l4', 'l5', 'demo'];
if (!bot || !which || !CASES.includes(which)) {
    console.error(`usage: bun speedrun/lab/herblore-accept.ts <bot> ${CASES.join('|')} [--to=99] [--relog-at=50] [--log=path]`);
    process.exit(2);
}
const where = () => `host ${hostname()} load ${loadavg().map(l => l.toFixed(1)).join(' ')} at ${new Date().toISOString()}`;

/** Supply lists by content debugname (notes are cert_<name>). */
const SUPPLY_SAFE: Record<string, number> = { guamvial: 41, iritvial: 405, eye_of_newt: 432 };
const RANGING_CAP: Record<string, number> = { harralandervial: 1, chocolate_dust: 1, ranarrvial: 8, iritvial: 10, eye_of_newt: 10, kwuarmvial: 17, limpwurt_root: 17, cadantinevial: 14, white_berries: 22, dwarfweedvial: 208, wine_of_zamorak: 208 };
const STAGED_H21E: Record<string, number> = { guamvial: 298, tarrominvial: 166, ranarrvial: 115, iritvial: 74, avantoevial: 53, kwuarmvial: 45, eye_of_newt: 418, limpwurt_root: 250, snape_grass: 190 };
/** delayfree-cycle.ts supplyPlan from 66 on superdefence,ranging: (ceil(n / 14) + 2) x 14 each line. */
const L4_LIST: Record<string, number> = { cadantinevial: 42, white_berries: 42, dwarfweedvial: 238, wine_of_zamorak: 238 };
const VARROCK_EAST_BANK = { x: 3253, z: 3420 };

const BOUND: Record<string, number | undefined> = { l1: 178, l2: 123 };

interface Metrics {
    workTicks: number;
    full: number;
    fullShare: number;
    landedFull: number;
    landedShare: number;
    bankOnlyTicks: number;
    cycleGaps: Record<number, number>;
    /** Ticks each visit waited past the steady one-tick booth wait (level-up pages), and in all. */
    backlog: { perVisit: number[]; total: number };
    visits: number;
    resets: number;
}

function metrics(sh: ItemCycleShared | undefined): Metrics | null {
    if (!sh) return null;
    const tl = sh.timeline;
    const work = tl.filter(r => r.pending > 0);
    const full = work.filter(r => r.sent >= 5).length;
    // a work tick's actions land on the next tick's state
    let landedFull = 0;
    for (const r of work) {
        const next = tl.find(x => x.t === r.t + 1);
        if (next && r.actions > 0 && next.landed >= r.actions) landedFull++;
    }
    const hist: Record<number, number> = {};
    for (const g of sh.cycleGaps) hist[g] = (hist[g] ?? 0) + 1;
    const perVisit = sh.visits.map(v => {
        let n = 0;
        for (let t = v.seen; tl.find(x => x.t === t)?.phase === 'opening'; t--) n++;
        return Math.max(0, n - 1);
    });
    return {
        workTicks: work.length,
        full,
        fullShare: work.length ? Math.round((full / work.length) * 1000) / 1000 : 0,
        landedFull,
        landedShare: work.length ? Math.round((landedFull / work.length) * 1000) / 1000 : 0,
        bankOnlyTicks: tl.filter(r => r.pending === 0 && r.sent > 0 && (r.phase === 'banking' || r.phase === 'opening')).length,
        cycleGaps: hist,
        backlog: { perVisit, total: perVisit.reduce((a, b) => a + b, 0) },
        visits: sh.visits.length,
        resets: sh.visits.filter(v => v.kind === 'reset').length
    };
}

// lab: the tab in the lab's Chrome, DevTools on WEB_PORT + 7; the demo never launches Chrome itself
const chrome: LabBrowser | null = which === 'demo' ? null : await launchLabBrowser(bot, { headless: process.argv.includes('--headless'), cdpPort: Number(process.env.WEB_PORT ?? '9300') + 7 });

const opened: Session = await openSession(bot, { client: 'browser', launch: true, insecureQueryLogin: which !== 'demo' });
let exitCode = 0;
await (async () => {
    const sdk = opened.sdk;
    const actions = opened.bot;
    const session = opened as unknown as RunnerSession;
    const log = TickLog.open(undefined, flag('log'));
    const state = () => sdk.getState() as BotWorldState;
    const to = Number(flag('to', '99'));
    const say = (cmd: string, settle = 0) => cheat(sdk, cmd, settle);

    const giveNotes = async (list: Record<string, number>) => {
        for (const [name, n] of Object.entries(list)) await say(`give cert_${name} ${n}`);
        await waitTicks(sdk, 3);
    };
    const openBooth = async () => {
        const booth = boothFor(state(), VARROCK_WEST);
        for (let i = 0; i < 10 && !state().bank.isOpen; i++) {
            await sdk.sendInteractLoc(booth.x, booth.z, booth.id, booth.option);
            await waitUntil(sdk, s => s.bank.isOpen, { maxTicks: 3 });
        }
        if (!state().bank.isOpen) throw new Error('the bank did not open');
    };
    const bankAll = async () => {
        await openBooth();
        const ids = [...new Set(state().inventory.map(i => i.id))];
        for (const id of ids) {
            const it = state().inventory.find(i => i.id === id);
            if (it) await sdk.sendBankDeposit(it.slot, -1);
        }
        await waitUntil(sdk, s => s.inventory.length === 0, { maxTicks: 10 });
        await sdk.sendCloseModal();
        await waitTicks(sdk, 2);
    };
    /** A clean lab start: off the island, empty bank and inventory, Herblore at `level`, standing at the booth. */
    const stage = async (level: number, opts: { walkIn?: boolean } = {}) => {
        await leaveTutorial(session, log);
        while (state().dialog.isOpen) {
            await sdk.sendClickDialog(0);
            await waitTicks(sdk, 1);
        }
        await say('~clearinv inv', 1);
        await say('~clearinv bank', 1);
        await setstat(sdk, 'herblore', level);
        if (opts.walkIn) {
            // a cold region load at the booth: arrive on foot from Varrock east bank
            await mustTele(sdk, VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z);
            const r = await actions.walkTo(SCORED_TILE.x, SCORED_TILE.z, 0);
            if (!near(state(), SCORED_TILE.x, SCORED_TILE.z)) throw new Error(`the walk in did not reach ${SCORED_TILE.x},${SCORED_TILE.z}: ${JSON.stringify(r)}`);
        } else {
            await mustTele(sdk, SCORED_TILE.x, SCORED_TILE.z);
        }
        await waitUntil(sdk, s => s.nearbyLocs.some(l => l.id === VARROCK_WEST.id && l.x === VARROCK_WEST.x && l.z === VARROCK_WEST.z), { maxTicks: 10 });
    };

    const s0Xp = () => herbloreXp(state());
    let result: Record<string, unknown> = { case: which, bot };
    const t0 = () => state().tick;
    const runStep = async (stepOpts: Parameters<typeof steps>[0] = {}) => {
        const pre = preconditions(state(), stepOpts);
        console.log(`  preconditions: ${pre === true ? 'pass' : pre}`);
        const start = t0();
        await runSteps(session, steps(stepOpts), { log, c: {}, shouldStop: () => false, logout: async () => {}, tickMonitor: false });
        return start;
    };
    const finish = (extra: Record<string, unknown>) => {
        const stepRows = log.rows.filter(r => !r.kind && r.step === STEP_NAME);
        const programs = log.rows.filter(r => r.kind === 'program').map(r => ({ ok: r.ok, ticks: r.ticks, ...(r.error ? { error: r.error } : {}), overBudget: (r.meta as { overBudget?: number }).overBudget ?? 0, result: (r.meta as { result?: unknown }).result }));
        const ticks = stepRows.reduce((n, r) => n + r.ticks, 0);
        const bound = BOUND[which];
        result = {
            ...result,
            stepTicks: stepRows.length ? ticks : null,
            stepOk: stepRows.length > 0 && stepRows.every(r => r.ok),
            ...(bound ? { bound, pass: stepRows.every(r => r.ok) && ticks <= bound } : {}),
            level: herbloreLevel(state()),
            programs,
            metrics: metrics(itemCycleShared(programStatus(state()))),
            ...extra
        };
    };

    console.log(`herblore-accept ${which}: ${where()}`);
    try {
        if (which === 'l1' || which === 'l5') {
            await stage(28, { walkIn: which === 'l1' });
            await giveNotes(SUPPLY_SAFE);
            result.startXp = s0Xp();
            result.postRitualXp = POST_RITUAL_XP;
            const plan = planRoute(s0Xp(), to, recipesFor(), stockFrom(state(), HERB_NOTES));
            result.plan = { actions: plan.actions, reaches: plan.reaches, expectedTicks: plan.expectedTicks, byRecipe: plan.byRecipe };
            if (which === 'l1') {
                await runStep({ to });
            } else {
                const relogAt = Number(flag('relog-at', '50'));
                const part = steps({ to: relogAt });
                await runSteps(session, part, { log, c: {}, shouldStop: () => false, logout: async () => {}, tickMonitor: false });
                const before = t0();
                const out = await logoutClean(opened);
                console.log(`  logged out at Herblore ${relogAt}: ${JSON.stringify(out)}`);
                await Bun.sleep(2_000);
                const relog = await login(opened);
                console.log(`  logged in again: ${JSON.stringify(relog)}`);
                const obs = new Observation(state());
                const point = await resolveResume(steps({ to }), obs, {});
                console.log(`  resume walk: ${point.mode} ${point.step ?? ''} (${point.reason})`);
                result.resume = { mode: point.mode, step: point.step, logoutTick: before };
                await runSteps(session, steps({ to }), { log, c: {}, shouldStop: () => false, logout: async () => {}, startMode: point.mode === 'resume' ? 'resume' : 'run', observed: obs, tickMonitor: false });
            }
            finish({});
        } else if (which === 'l2') {
            await stage(28);
            await giveNotes(RANGING_CAP);
            await bankAll();
            result.startXp = s0Xp();
            await runStep({ to });
            finish({});
        } else if (which === 'l3') {
            await stage(28);
            await giveNotes(STAGED_H21E);
            const plan = planRoute(s0Xp(), to, recipesFor(), stockFrom(state(), HERB_NOTES));
            const reason = preconditions(state(), { to });
            console.log(`  preconditions: ${reason === true ? 'pass' : reason}`);
            let fault: string | null = null;
            try {
                await runItemCycle({ sdk, session, log }, { mode: 'pair', skill: 'herblore', recipes: recipesFor(), booth: boothFor(state()), untilLevel: to, step: STEP_NAME });
            } catch (e) {
                fault = e instanceof Error ? e.message : String(e);
            }
            const ran = log.rows.find(r => r.kind === 'program');
            finish({
                reason,
                fault,
                plan: { reaches: plan.reaches, level: plan.level, baseShort: Math.ceil(plan.xpShort / 25), actions: plan.actions, byRecipe: plan.byRecipe, expectedTicks: plan.expectedTicks },
                programTicks: ran?.ticks ?? null,
                vsExpected: ran ? Math.round((ran.ticks / plan.expectedTicks - 1) * 1000) / 10 : null,
                pass: !!ran && Math.abs(ran.ticks / plan.expectedTicks - 1) <= 0.05,
                baseShortMeasured: Math.ceil((xpForLevel(to) - s0Xp()) / 25)
            });
        } else if (which === 'l4') {
            await stage(66);
            await giveNotes(L4_LIST);
            await runStep({ to, recipes: ['superdefence', 'ranging'] });
            finish({});
        } else {
            // demo: no staff commands; the booth in view, the account's own supplies. Right after a
            // login the position is published before the scene's locs (herblore.ts preconditions).
            const quickBooth = (st: BotWorldState) => st.nearbyLocs.filter(l => /^bank booth$/i.test(l.name) && l.optionsWithIndex.some(o => /^use-quickly$/i.test(o.text))).sort((a, b) => a.distance - b.distance)[0];
            const waited = await waitUntil(sdk, st => !!quickBooth(st), { maxTicks: 60 });
            let s = state();
            const booth = quickBooth(s);
            if (!booth) throw new Error(`no bank booth with Use-quickly in view at ${s.player?.worldX},${s.player?.worldZ} (tick ${s.tick}, wait ${waited.ok ? 'ok' : waited.reason}; ${s.nearbyLocs.length} locs, ${s.nearbyNpcs.length} npcs; booths ${JSON.stringify(s.nearbyLocs.filter(l => /booth/i.test(l.name)).slice(0, 4).map(l => [l.name, l.x, l.z, l.optionsWithIndex.map(o => o.text)]))})`);
            const op = booth.optionsWithIndex.find(o => /^use-quickly$/i.test(o.text))!.opIndex;
            // stand where the game's own route to the booth ends, so the program's booth clicks can go unrouted
            const from = [s.player?.worldX, s.player?.worldZ];
            for (let i = 0; i < 10 && !state().bank.isOpen; i++) {
                await sdk.sendInteractLoc(booth.x, booth.z, booth.id, op);
                await waitUntil(sdk, st => st.bank.isOpen, { maxTicks: 8 });
            }
            if (!state().bank.isOpen) throw new Error(`the booth (${booth.x},${booth.z}) did not open from ${from}`);
            await sdk.sendCloseModal();
            await waitTicks(sdk, 2);
            s = state();
            const held = s.inventory.map(i => ({ id: i.id, name: i.name, count: i.count }));
            result.account = { herblore: herbloreLevel(s), xp: herbloreXp(s), held, from, at: [s.player?.worldX, s.player?.worldZ], booth: [booth.x, booth.z, booth.id] };
            let fault: string | null = null;
            try {
                await runItemCycle({ sdk, session, log }, { mode: 'pair', skill: 'herblore', recipes: recipesFor(['attack']), booth: { x: booth.x, z: booth.z, id: booth.id, option: op, stand: { x: s.player!.worldX, z: s.player!.worldZ } }, maxActions: 28, step: 'demo herblore' });
            } catch (e) {
                fault = e instanceof Error ? e.message : String(e);
            }
            // hand the account back as it was: its own items out of the bank again, or an empty inventory
            const invKey = (inv: { id: number; count: number }[]) => inv.map(i => `${i.id}x${i.count}`).sort().join(',');
            if (invKey(state().inventory) !== invKey(held)) {
                for (let i = 0; i < 10 && !state().bank.isOpen; i++) {
                    await sdk.sendInteractLoc(booth.x, booth.z, booth.id, op);
                    await waitUntil(sdk, st => st.bank.isOpen, { maxTicks: 3 });
                }
                for (const it of state().inventory) await sdk.sendBankDeposit(it.slot, -1);
                await waitTicks(sdk, 2);
                for (const h of held) {
                    const b = state().bank.items.find(x => x.id === h.id && x.count > 0);
                    if (b) await actions.withdrawItem(b, h.count);
                }
                await sdk.sendCloseModal();
                await waitTicks(sdk, 2);
            }
            finish({ fault, label: `demo, ${bot} at Herblore ${herbloreLevel(s)}`, restored: invKey(state().inventory) === invKey(held) });
        }
    } catch (e) {
        exitCode = 1;
        finish({ error: e instanceof Error ? e.message : String(e) });
    } finally {
        console.log(`RESULT ${JSON.stringify({ ...result, levelFromXp: levelForXp(herbloreXp(state())), host: hostname(), log: log.path })}`);
        await logoutClean(opened).catch(() => {});
        await closeSession(opened).catch(() => {});
        await chrome?.kill().catch(() => {});
    }
})();
process.exit(exitCode);
