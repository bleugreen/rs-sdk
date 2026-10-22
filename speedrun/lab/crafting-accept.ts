// Lab acceptance for S25d (speedrun/skills/crafting.ts, STEP-MANIFEST.md entry 28): hard leather
// bodies in item-cycle's tool mode, in a browser tab this script opens (lib/session openSession, as
// herblore-accept.ts does; lite hosts no programs). Through lab.sh on its own port block (LAB.md),
// on bgsrv-mac, bgsrv-ub or fedora, never `local`:
//
//   (cd server/webclient && bun run build)
//   NODE_TICKRATE=300 LAB_RUNNERS=0 WEB_PORT=9040 WEB_MANAGEMENT_PORT=9041 HISCORES_WEB_PORT=9042 \
//     NODE_PORT=43740 AGENT_PORT=7940 LAB_TIMEOUT=2700 \
//     speedrun/lab/lab.sh <lab-bot> speedrun/lab/crafting-accept.ts:l1 ...
//
// Chrome's DevTools port is WEB_PORT + 7. --headless for a runner without a display.
//
// cases (each empties the bot's bank and inventory first; staging leaves Tutorial Island through
// S00's tutorialSkip, setup.ts leaveTutorial, before any teleport):
//   l1    S25d's real start: Crafting 45, the hand-off held (needle, 230 thread, 954 hard leather
//         as banknotes, with H21d/H21e's chisel, gem and herb notes beside them). Cold arrival: ::tele
//         to Varrock east bank, then walk in to (3185,3436). To CRAFTING_HANDOFF_XP; the last visit
//         stows needle, thread and bodies. Reported against --expected (rs/158's figure).
//   l2    standalone: as l1 with 1,142 leather notes (rs/350's staging), to 99.
//   cold  the browser standard: the cold walk-in, then two inventories (maxActions 52) and the stow.
//         The first booth click's latency and the first refill are what it measures.
//   l5    resume mid-inventory: l1's start, the program stopped with half an inventory cut
//         (maxActions 10 x 26 + 13, no stow), a clean logout, login, resolveResume, the step's resume.
//   demo  a borrowed account at Crafting >= 28 with its own needle, thread and hard leather banked
//         or held, at a booth in view: maxActions 26 and the stow, then its items back out as they
//         were. No staff commands.
// options: --expected=<ticks> (l1), --log=<path>
// Prints one RESULT line per case: ticks, ticks per inventory, the cycle-gap histogram, the
// per-tick event peak, overBudget, and the level-up backlog.

import { readFileSync, writeFileSync } from 'fs';
import { hostname, loadavg } from 'os';
import { join } from 'path';
import type { BotWorldState } from '../../sdk/types';
import { itemCycleShared, runItemCycle, type ItemCycleShared } from '../lib/item-cycle';
import { programStatus } from '../lib/programs';
import { closeSession, login, logoutClean, openSession, type Session } from '../lib/session';
import { TickLog } from '../lib/ticks';
import { waitTicks, waitUntil } from '../lib/wait';
import { levelForXp, xpForLevel } from '../lib/xp';
import { Observation, resolveResume } from '../runner/resume';
import { runSteps, type RunnerSession } from '../runner/step';
import { boothFor, SCORED_TILE, VARROCK_WEST } from '../skills/herblore';
import { CRAFTING_99_XP, CRAFTING_HANDOFF_XP, craftingLevel, craftingXp, cycleItems, HARD_LEATHER_BODY, ITEM, LOAD, preconditions, STEP_NAME, steps, supplyFor } from '../skills/crafting';
import { cheat, leaveTutorial, mustTele, near, setstat } from './setup';

const bot = process.argv[2];
const which = process.argv[3];
const flag = (name: string, def?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const CASES = ['l1', 'l2', 'cold', 'l5', 'demo'];
if (!bot || !which || !CASES.includes(which)) {
    console.error(`usage: bun speedrun/lab/crafting-accept.ts <bot> ${CASES.join('|')} [--expected=N] [--log=path]`);
    process.exit(2);
}
const where = () => `host ${hostname()} load ${loadavg().map(l => l.toFixed(1)).join(' ')} at ${new Date().toISOString()}`;

const START_LEVEL = 45;
const VARROCK_EAST_BANK = { x: 3253, z: 3420 };
/** H21d/H21e's stacks for later steps, handed over with S25d's (the first visit banks them). */
const LATER_STACKS: Record<string, number> = { chisel: 1, cert_uncut_diamond: 107, cert_iritvial: 405, cert_eye_of_newt: 432 };

interface Metrics {
    workTicks: number;
    fullShare: number;
    cycleGaps: Record<number, number>;
    /** Open-to-open ticks per inventory, over the steady visits (all but the first and the stow). */
    ticksPerInventory: number | null;
    /** The most user events the program sent on one tick, and the ticks at each count. */
    eventPeak: number;
    sendsPerTick: Record<number, number>;
    backlog: { perVisit: number[]; total: number };
    visits: number;
    resets: number;
    stows: number;
}

function metrics(sh: ItemCycleShared | undefined): Metrics | null {
    if (!sh) return null;
    const tl = sh.timeline;
    const work = tl.filter(r => r.pending > 0);
    const hist: Record<number, number> = {};
    for (const g of sh.cycleGaps) hist[g] = (hist[g] ?? 0) + 1;
    const steady = sh.cycleGaps.slice(1, sh.visits.at(-1)?.kind === 'stow' ? -1 : undefined);
    const perVisit = sh.visits.map(v => {
        let n = 0;
        for (let t = v.seen; tl.find(x => x.t === t)?.phase === 'opening'; t--) n++;
        return Math.max(0, n - 1);
    });
    const peaks = tl.map(r => r.sent);
    return {
        workTicks: work.length,
        fullShare: work.length ? Math.round((work.filter(r => r.sent >= 5).length / work.length) * 1000) / 1000 : 0,
        cycleGaps: hist,
        ticksPerInventory: steady.length ? Math.round((steady.reduce((a, b) => a + b, 0) / steady.length) * 100) / 100 : null,
        eventPeak: Math.max(0, ...peaks),
        sendsPerTick: sh.sendsPerTick,
        backlog: { perVisit, total: perVisit.reduce((a, b) => a + b, 0) },
        visits: sh.visits.length,
        resets: sh.visits.filter(v => v.kind === 'reset').length,
        stows: sh.visits.filter(v => v.kind === 'stow').length
    };
}

const webPort = process.env.WEB_PORT ?? '9300';
const agentPort = process.env.AGENT_PORT ?? '8300';
if (which !== 'demo') {
    const envFile = join(process.cwd(), 'bots', bot, 'bot.env');
    const text = readFileSync(envFile, 'utf8');
    writeFileSync(envFile, text.replace(/^CLIENT_URL=.*\n?/m, '').trimEnd() + `\nCLIENT_URL=http://localhost:${webPort}/bot?gateway=${encodeURIComponent(`ws://localhost:${agentPort}`)}\n`, { mode: 0o600 });
    const cdpPort = Number(webPort) + 7;
    // loaded here, not at the top: the demo attaches to a running Chrome over CDP, and puppeteer's
    // module graph does not load under bun on bbs (proxy-agent's `debug` import)
    const puppeteer = (await import('puppeteer')).default;
    await puppeteer.launch({
        headless: process.argv.includes('--headless'),
        defaultViewport: null,
        args: ['--no-sandbox', '--window-size=800,660', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${cdpPort}`]
    });
    process.env.SPEEDRUN_CDP_URL = `http://127.0.0.1:${cdpPort}`;
}

const opened: Session = await openSession(bot, { client: 'browser', launch: true, insecureQueryLogin: which !== 'demo' });
let exitCode = 0;
await (async () => {
    const sdk = opened.sdk;
    const actions = opened.bot;
    const session = opened as unknown as RunnerSession;
    const log = TickLog.open(undefined, flag('log'));
    const state = () => sdk.getState() as BotWorldState;
    const say = (cmd: string, settle = 0) => cheat(sdk, cmd, settle);

    const give = async (list: Record<string, number>) => {
        for (const [name, n] of Object.entries(list)) await say(`give ${name} ${n}`);
        await waitTicks(sdk, 3);
    };
    /** A clean lab start: off the island, empty bank and inventory, Crafting 45, at the booth (walked in cold, or teleported). */
    const stage = async (opts: { walkIn?: boolean } = {}) => {
        // S00 on a fresh account in a tab is occasionally slow to get the guide's first page (LAB.md):
        // a staging retry, not part of anything measured
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
        await say('~clearinv inv', 1);
        await say('~clearinv bank', 1);
        await setstat(sdk, 'crafting', START_LEVEL);
        if (opts.walkIn) {
            await mustTele(sdk, VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z);
            const r = await actions.walkTo(SCORED_TILE.x, SCORED_TILE.z, 0);
            if (!near(state(), SCORED_TILE.x, SCORED_TILE.z)) throw new Error(`the walk in did not reach ${SCORED_TILE.x},${SCORED_TILE.z}: ${JSON.stringify(r)}`);
        } else {
            await mustTele(sdk, SCORED_TILE.x, SCORED_TILE.z);
        }
        await waitUntil(sdk, s => s.nearbyLocs.some(l => l.id === VARROCK_WEST.id && l.x === VARROCK_WEST.x && l.z === VARROCK_WEST.z), { maxTicks: 10 });
    };
    const handOff = async (leather: number) => {
        await give({ needle: 1, thread: 230, cert_hard_leather: leather, ...LATER_STACKS });
    };

    let result: Record<string, unknown> = { case: which, bot };
    const runStep = async (stepOpts: Parameters<typeof steps>[0] = {}) => {
        const pre = preconditions(state(), stepOpts);
        console.log(`  preconditions: ${pre === true ? 'pass' : pre}`);
        result.preconditions = pre;
        await runSteps(session, steps(stepOpts), { log, c: {}, shouldStop: () => false, logout: async () => {}, tickMonitor: false });
    };
    const finish = (extra: Record<string, unknown>) => {
        const stepRows = log.rows.filter(r => !r.kind && r.step === STEP_NAME);
        const programs = log.rows.filter(r => r.kind === 'program').map(r => ({ ok: r.ok, ticks: r.ticks, ...(r.error ? { error: r.error } : {}), overBudget: (r.meta as { overBudget?: number }).overBudget ?? 0, result: (r.meta as { result?: unknown }).result }));
        const ticks = stepRows.reduce((n, r) => n + r.ticks, 0);
        const expected = which === 'l1' ? Number(flag('expected', '0')) || null : null;
        result = {
            ...result,
            stepTicks: stepRows.length ? ticks : null,
            stepOk: stepRows.length > 0 && stepRows.every(r => r.ok),
            ...(expected ? { expected, vsExpected: Math.round((ticks / expected - 1) * 1000) / 10, pass: stepRows.every(r => r.ok) && ticks <= expected * 1.05 } : {}),
            level: craftingLevel(state()),
            xp: craftingXp(state()),
            heldAfter: cycleItems(state()),
            freeSlotsAfter: 28 - state().inventory.filter(i => i.count > 0).length,
            programs,
            overBudget: programs.reduce((n, p) => n + p.overBudget, 0),
            metrics: metrics(itemCycleShared(programStatus(state()))),
            ...extra
        };
    };

    console.log(`crafting-accept ${which}: ${where()}`);
    try {
        if (which === 'l1' || which === 'l2' || which === 'cold') {
            await stage({ walkIn: true });
            const untilXp = which === 'l2' ? CRAFTING_99_XP : CRAFTING_HANDOFF_XP;
            await handOff(which === 'l2' ? 1142 : 954);
            result.startXp = craftingXp(state());
            result.supply = supplyFor(craftingXp(state()), untilXp);
            await runStep(which === 'cold' ? { maxActions: 2 * LOAD } : { untilXp });
            finish({ untilXp, reached: craftingXp(state()) >= untilXp, overshootXp: craftingXp(state()) - untilXp });
        } else if (which === 'l5') {
            await stage();
            await handOff(954);
            result.startXp = craftingXp(state());
            // stop mid-inventory, the way a logout would leave it: no stow
            const part = 10 * LOAD + 13;
            await runItemCycle({ sdk, session, log }, { mode: 'tool', skill: 'crafting', recipes: [HARD_LEATHER_BODY], booth: boothFor(state()), maxActions: part, step: 'S25d part' });
            const held = state().inventory.map(i => [i.slot, i.id, i.count]);
            const before = state().tick;
            const out = await logoutClean(opened);
            console.log(`  logged out mid-inventory (${part} bodies): ${JSON.stringify(out)}`);
            await Bun.sleep(2_000);
            const relog = await login(opened);
            console.log(`  logged in again: ${JSON.stringify(relog)}`);
            const obs = new Observation(state());
            const point = await resolveResume(steps(), obs, {});
            console.log(`  resume walk: ${point.mode} ${point.step ?? ''} (${point.reason})`);
            result.resume = { mode: point.mode, step: point.step, logoutTick: before, heldAtLogout: held };
            await runSteps(session, steps(), { log, c: {}, shouldStop: () => false, logout: async () => {}, startMode: point.mode === 'resume' ? 'resume' : 'run', observed: obs, tickMonitor: false });
            finish({ untilXp: CRAFTING_HANDOFF_XP, reached: craftingXp(state()) >= CRAFTING_HANDOFF_XP });
        } else {
            // demo: no staff commands; the account's own needle, thread and leather, a booth in view.
            // Right after a login the position is published before the scene's locs: wait for the booth.
            const quickBooth = (st: BotWorldState) => st.nearbyLocs.some(l => /^bank booth$/i.test(l.name) && l.optionsWithIndex.some(o => /^use-quickly$/i.test(o.text)));
            // a tab on a remote host can publish the player well before the region's scene (bbs, 2026-10-22)
            await waitUntil(sdk, quickBooth, { maxTicks: 60 });
            const s = state();
            const booth = s.nearbyLocs.filter(l => /^bank booth$/i.test(l.name) && l.optionsWithIndex.some(o => /^use-quickly$/i.test(o.text))).sort((a, b) => a.distance - b.distance)[0];
            if (!booth) {
                const seen = s.nearbyLocs.slice(0, 8).map(l => `${l.name}#${l.id}@${l.x},${l.z}[${l.options.join('/')}]`);
                throw new Error(`no bank booth with Use-quickly in view at ${s.player?.worldX},${s.player?.worldZ} (tick ${s.tick}; ${s.nearbyLocs.length} locs, ${s.nearbyNpcs.length} npcs in view: ${seen.join(', ') || 'none'})`);
            }
            if (craftingLevel(s) < HARD_LEATHER_BODY.level) throw new Error(`Crafting ${craftingLevel(s)} < ${HARD_LEATHER_BODY.level}: hard leather bodies need 28`);
            const held = s.inventory.map(i => ({ id: i.id, name: i.name, count: i.count }));
            result.account = { crafting: craftingLevel(s), xp: craftingXp(s), held, at: [s.player?.worldX, s.player?.worldZ], booth: [booth.x, booth.z, booth.id] };
            const op = booth.optionsWithIndex.find(o => /^use-quickly$/i.test(o.text))!.opIndex;
            let fault: string | null = null;
            try {
                await runItemCycle({ sdk, session, log }, { mode: 'tool', skill: 'crafting', recipes: [HARD_LEATHER_BODY], booth: { x: booth.x, z: booth.z, id: booth.id, option: op, stand: { x: s.player!.worldX, z: s.player!.worldZ } }, maxActions: LOAD, stow: true, step: 'demo crafting' });
            } catch (e) {
                fault = e instanceof Error ? e.message : String(e);
            }
            // read the cycle's bank line, then hand the account back as it was: its own items out again
            for (let i = 0; i < 10 && !state().bank.isOpen; i++) {
                await sdk.sendInteractLoc(booth.x, booth.z, booth.id, op);
                await waitUntil(sdk, st => st.bank.isOpen, { maxTicks: 3 });
            }
            const bankLine = Object.fromEntries(Object.entries(ITEM).map(([k, id]) => [k, state().bank.items.filter(b => b.id === id).reduce((n, b) => n + b.count, 0)]));
            if (held.length) {
                for (const it of state().inventory) await sdk.sendBankDeposit(it.slot, -1);
                await waitTicks(sdk, 2);
                for (const h of held) {
                    const b = state().bank.items.find(x => x.id === h.id && x.count > 0);
                    if (b) await actions.withdrawItem(b, h.count);
                }
            }
            await sdk.sendCloseModal();
            await waitTicks(sdk, 2);
            const after = state().inventory.map(i => ({ id: i.id, count: i.count }));
            finish({ fault, label: `demo, Crafting ${craftingLevel(s)}`, bankLine, restored: JSON.stringify(after.sort((a, b) => a.id - b.id)) === JSON.stringify(held.map(h => ({ id: h.id, count: h.count })).sort((a, b) => a.id - b.id)) });
        }
    } catch (e) {
        exitCode = 1;
        finish({ error: e instanceof Error ? e.message : String(e) });
    } finally {
        console.log(`RESULT ${JSON.stringify({ ...result, levelFromXp: levelForXp(craftingXp(state())), host: hostname(), log: log.path, xp99: xpForLevel(99) })}`);
        const out = await logoutClean(opened).catch(e => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
        console.log(`LOGOUT ${JSON.stringify(out)}`);
        await closeSession(opened).catch(() => {});
    }
})();
process.exit(exitCode);
