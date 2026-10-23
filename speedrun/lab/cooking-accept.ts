// Lab acceptance for S25c (speedrun/skills/cooking.ts, STEP-MANIFEST.md entry 29): the wine
// sequence on the two planned relogs, driven through the module (runSteps over steps()), with the
// gems cut by item-cycle in a browser tab (lite hosts no programs). The giver is a lite client
// running wine.ts giveWine's afterRelog. Through lab.sh on its own port block, on bgsrv-mac,
// bgsrv-ub or fedora, never `local`, after `(cd server/webclient && bun run build)`:
//
//   NODE_TICKRATE=300 LAB_RUNNERS=0 LAB_BOTS=ckgive WEB_PORT=9660 WEB_MANAGEMENT_PORT=9661 \
//     HISCORES_WEB_PORT=9662 NODE_PORT=44660 AGENT_PORT=8660 LAB_TIMEOUT=3000 \
//     speedrun/lab/lab.sh ckrecv speedrun/lab/cooking-accept.ts:ckgive:ww:--variant=gems --headless
//
// argv: <receiver> <giver> <case> [--variant=plain|gems] [--chisel=banked|held] [--headless]
// cases (each stages both accounts from scratch: S00's tutorialSkip before any teleport):
//   ww      research/wine-window.md section 1's fixture, for comparison with its 75-76: Cooking 1,
//           Crafting 55, uncut dragonstones (the recipe passed as data), the 160-gem quota. The
//           module cuts 107 in the windows; the rest of the quota is cut standalone after it. plain:
//           windowWork 'none', then all 160 standalone. Normalised = ticks less the first firing's
//           Cooking level-ups (one page script a tick), as WW normalises.
//   run     the run's own start: Cooking 30, Crafting at the hand-off for H21d's staged gems
//           (craftingHandoffXp; steps() reads the same row by default), the fleet's 108 gems
//           (2 diamond, 20 ruby, 23 emerald, 63 sapphire: the 108th stays banked), the chisel
//           banked (S25d stows it) or held. Reports the inventory slots at each point, burst 1's
//           ticks, the P1 leak.
//   resume  `run`'s start, the session dropped at relog 2 (a logout between the firings), then
//           resolveResume with the wineBank probe and the step's resume.
//   demo    run A's shape on the demo world: a throwaway receiver at Cooking 1 (lite, loopback
//           gateway, no staff commands; it walks to the stand tile), windowWork 'none'; the
//           giver is a throwaway wine maker running rs/41's `wine` role with afterRelog and
//           <giver> as its name. Pass: session ticks within 10% of run A's 80.
// Prints one RESULT line: the step's ticks, normalised, each relog's cost and path, the firing
// offsets from each login, the slot timeline's points, burst 1's open-to-close ticks, P1's pages.

import { readFileSync } from 'fs';
import { hostname, loadavg } from 'os';
import { join } from 'path';
import type { BotWorldState } from '../../sdk/types';
import { ITEM as WINE } from '../helpers/wine-common';
import { openBankThroughPages, type ReceiverSdk } from '../helpers/wine-receive';
import { pageText } from '../lib/dialogue';
import { runItemCycle, type ItemRecipe } from '../lib/item-cycle';
import { closeSession, login, logoutClean, openSession, relog, type RelogResult, type Session } from '../lib/session';
import { TickLog } from '../lib/ticks';
import { waitTicks, waitUntil } from '../lib/wait';
import { levelForXp, xpForLevel } from '../lib/xp';
import { Observation, resolveResume } from '../runner/resume';
import { runSteps, type RunnerSession } from '../runner/step';
import { CHISEL, PROBES, STEP_NAME, steps, type CookingOptions } from '../skills/cooking';
import { craftingHandoffXp, loadStagedGems } from '../skills/crafting';
import { boothFor, SCORED_TILE, VARROCK_WEST } from '../skills/herblore';
import { launchLabBrowser, type LabBrowser } from './browser';
import { cheat, leaveTutorial, mustTele } from './setup';
import { serveWine, stageWineGiver } from './wine-giver';

const [receiver, giverName, which] = process.argv.slice(2);
const flag = (name: string, def: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const CASES = ['ww', 'run', 'resume', 'demo'];
if (!receiver || !giverName || !which || !CASES.includes(which)) {
    console.error(`usage: bun speedrun/lab/cooking-accept.ts <receiver> <giver> ${CASES.join('|')} [--variant=plain|gems] [--chisel=banked|held] [--headless]`);
    process.exit(2);
}
const variant = flag('variant', 'gems') as 'plain' | 'gems';
const chiselAt = flag('chisel', 'banked') as 'banked' | 'held';
const where = () => `host ${hostname()} load ${loadavg().map(l => l.toFixed(1)).join(' ')} at ${new Date().toISOString()}`;

const ROOT = join(import.meta.dir, '../..');
const OBJ: Record<string, number> = {};
for (const line of readFileSync(join(ROOT, 'server/content/pack/obj.pack'), 'utf8').split('\n')) {
    const m = line.match(/^(\d+)=(\S+)/);
    if (m) OBJ[m[2]!] = Number(m[1]);
}
const id = (n: string) => {
    const v = OBJ[n];
    if (v === undefined) throw new Error(`unknown obj ${n}`);
    return v;
};
/** WW section 1's recipe: dragonstone at Crafting 55 (gem.dbrow, 137.5 base). */
const DRAGONSTONE: ItemRecipe = { name: 'dragonstone', level: 55, xp: 137.5, a: id('uncut_dragonstone'), tool: CHISEL, products: [id('dragonstone')] };
const WW_QUOTA = 160;
const RUN_GEMS: Record<string, number> = { uncut_diamond: 2, uncut_ruby: 20, uncut_emerald: 23, uncut_sapphire: 63 };

// ---------------------------------------------------------------- the clients

const demo = which === 'demo';
// lab: the receiver's tab in the lab's Chrome, DevTools on WEB_PORT + 7
const chrome: LabBrowser | null = demo ? null : await launchLabBrowser(receiver, { headless: process.argv.includes('--headless'), cdpPort: Number(process.env.WEB_PORT ?? '9660') + 7 });
// demo: run A's shape (the plain sequence) needs no page program, so the receiver is a lite client
// on its loopback gateway (openSession refuses the demo relay); the giver is rs/41's `wine` role
// with afterRelog, run by the fleet, not by this script
const recv: Session = demo ? await openSession(receiver, { launch: true }) : await openSession(receiver, { client: 'browser', launch: true, insecureQueryLogin: true });
const giver: Session | null = demo ? null : await openSession(giverName, { launch: true });
const sdk = recv.sdk;
const session = recv as unknown as RunnerSession;
const state = () => sdk.getState() as BotWorldState;
const log = TickLog.open(undefined, flag('log', '') || undefined);

// ---------------------------------------------------------------- observation

interface Point {
    tick: number;
    /** The session (a launch relog restarts the tick count). */
    seg: number;
    used: number;
    bank: boolean;
    page: string;
}
const timeline: Point[] = [];
let seg = 0;
sdk.onStateUpdate(s => {
    const used = s.inventory.filter(i => i.count > 0).length;
    const page = s.dialog?.isOpen ? pageText(s.dialog).slice(0, 60) : '';
    const last = timeline.at(-1);
    if (last && s.tick < last.tick) seg++;
    if (!last || last.used !== used || last.bank !== s.bank.isOpen || last.page !== page || last.tick !== s.tick) timeline.push({ tick: s.tick, seg, used, bank: s.bank.isOpen, page });
});

// ---------------------------------------------------------------- staging

const say = (cmd: string, settle = 0) => cheat(sdk, cmd, settle);

async function offIsland(s: Session): Promise<void> {
    for (let attempt = 1; ; attempt++) {
        try {
            await leaveTutorial(s as unknown as RunnerSession, log);
            return;
        } catch (e) {
            if (attempt >= 3) throw e;
            await s.sdk.sendCloseModal().catch(() => {});
            await waitTicks(s.sdk, 3);
        }
    }
}

async function bankEverything(keepChisel: boolean): Promise<void> {
    const open = await openBankThroughPages(sdk as unknown as ReceiverSdk, { maxTicks: 30 });
    if (!open.ok) throw new Error(`staging: bank did not open (${open.reason})`);
    const ids = new Set(state().inventory.filter(i => !(keepChisel && i.id === CHISEL)).map(i => i.id));
    for (const oid of ids) {
        const it = state().inventory.find(i => i.id === oid);
        if (it) await sdk.sendBankDeposit(it.slot, -1);
    }
    await waitTicks(sdk, 2);
    await sdk.sendCloseModal();
    await waitUntil(sdk, s => !s.bank.isOpen, { maxTicks: 6 });
}

async function stage(o: { cooking: number; crafting: number; gems: Record<string, number>; chisel: 'banked' | 'held' }): Promise<void> {
    if (!giver) throw new Error('staging needs the lab giver');
    await Promise.all([offIsland(recv), offIsland(giver)]);
    while (state().dialog.isOpen) {
        await sdk.sendClickDialog(0);
        await waitTicks(sdk, 1);
    }
    await say('~clearinv inv', 1);
    await say('~clearinv bank', 1);
    await say(`setstat cooking ${o.cooking}`, 1);
    // ::setstat sets the level's floor xp (there is no exact-xp cheat): the run case starts at
    // the hand-off level's floor, below the hand-off xp, and reports where the staged gems leave it
    await say(`setstat crafting ${o.crafting}`, 1);
    await mustTele(sdk, SCORED_TILE.x, SCORED_TILE.z);
    await waitUntil(sdk, s => s.nearbyLocs.some(l => l.id === VARROCK_WEST.id && l.x === VARROCK_WEST.x && l.z === VARROCK_WEST.z), { maxTicks: 20 });
    for (const [name, n] of Object.entries(o.gems)) await say(`give cert_${name} ${n}`);
    await say('give chisel 1', 2);
    await bankEverything(o.chisel === 'held');
    // the giver: beside SCORED's stand with the 520 notes, nothing else
    if (!giver) return;
    await stageWineGiver(giver);
    // 16 ticks quiet before relog 1 (the precondition's combat rule; nothing hits here)
    await waitTicks(sdk, 2);
}

// ---------------------------------------------------------------- the run

const result: Record<string, unknown> = { case: which, variant, chisel: chiselAt, receiver, giver: giverName };
let exitCode = 0;

function notes(): Array<Record<string, unknown>> {
    return log.rows.filter(r => r.kind === 'note' && r.step === STEP_NAME).map(r => r.meta as Record<string, unknown>);
}

function report(cookingStart: number): void {
    const stepRows = log.rows.filter(r => !r.kind && r.step === STEP_NAME);
    // scored ticks: each session's span (a launch relog restarts the count) plus each relog's cost
    const spans = [...new Set(timeline.map(p => p.seg))].map(sg => {
        const ps = timeline.filter(p => p.seg === sg);
        return ps.at(-1)!.tick - ps[0]!.tick;
    });
    const relogRows = notes().filter(n => n.what === 'relog');
    const ticks = spans.reduce((a, b) => a + b, 0) + relogRows.reduce((n, r) => n + (r.cost as number) + Math.max(0, r.logoutLatency as number), 0);
    const end = notes().filter(n => n.what === 'S25c end').at(-1) ?? {};
    const relogs = notes().filter(n => n.what === 'relog');
    const levelAfterFirst = (end.levelAfterFirst as number | undefined) ?? null;
    // WW normalises by the first chain's Cooking pages, one script a tick: P1's page ticks (a 29-wine
    // firing crosses many levels in fewer scripts, so the level count overstates it)
    const chain = typeof end.pagesTicks === 'number' ? (end.pagesTicks as number) : null;
    void levelAfterFirst;
    void cookingStart;
    // the standalone quota runs after the step, in the last session: the spans already cover it
    const standalone = log.rows.filter(r => r.kind === 'program' && r.step === 'S25c lab standalone').reduce((n, r) => n + r.ticks, 0);
    const total = ticks;
    const deposit = notes().find(n => n.what === 'wine deposit');
    // the bank's open intervals: burst 1 is the first, P1's rest burst the second
    const opens: Array<[number, number]> = [];
    for (let i = 1; i < timeline.length; i++) {
        if (timeline[i]!.bank && !timeline[i - 1]!.bank) opens.push([timeline[i]!.tick, -1]);
        if (!timeline[i]!.bank && timeline[i - 1]!.bank && opens.length) opens.at(-1)![1] = timeline[i]!.tick;
    }
    const loginTicks = relogs.map(r => r.loginTick as number);
    const ferments = [end.firstFermentTick, end.secondFermentTick] as number[];
    const peak = Math.max(...timeline.map(p => p.used));
    const usedAt = (t: number) => [...timeline].reverse().find(p => p.tick <= t)?.used ?? null;
    const p1Seg = timeline.find(p => p.seg > 0)?.seg ?? 0;
    const p1 = ferments[0] ? timeline.filter(p => p.seg === p1Seg && p.tick >= ferments[0]! && p.page && !p.bank) : [];
    Object.assign(result, {
        stepTicks: ticks,
        standaloneTicks: standalone,
        totalTicks: total,
        firstChainLevelups: chain,
        normalised: chain === null ? null : total - chain,
        cooking: levelForXp(state().skills.find(k => k.name === 'Cooking')?.experience ?? 0),
        craftingXp: state().skills.find(k => k.name === 'Crafting')?.experience ?? 0,
        relogs: relogs.map(r => ({ kind: r.kind, via: r.via, cost: r.cost, logoutLatency: r.logoutLatency })),
        spans,
        // from the tick each login armed the timer on (tickBase + 1): 20 is on time
        firingOffsets: ferments.map((f, i) => (f && relogRows[i] ? f - ((relogRows[i]!.tickBase as number) + 1) : null)),
        burst1: deposit ? { bankOpenVsLogin: (deposit.bankOpenTick as number) - (relogRows[0]?.tickBase as number ?? 0), openToDone: (deposit.doneTick as number) - (deposit.bankOpenTick as number), held: deposit.held } : null,
        p1: { pagesTicks: end.pagesTicks ?? null, pages: end.pagesAfterFirst ?? null, secondBankTicks: end.secondBankTicks ?? null, craftingPageTicks: new Set(p1.filter(p => /crafting/i.test(p.page)).map(p => p.tick)).size },
        slots: { peak, relog1: loginTicks[0] !== undefined ? usedAt(loginTicks[0] - 1) : null, afterBurst1: opens[0] ? usedAt(opens[0][1]) : null, afterRest: opens[1] ? usedAt(opens[1][1]) : null, relog2: loginTicks.at(-1) !== undefined ? usedAt(loginTicks.at(-1)! + 1) : null, end: state().inventory.length },
        burst1Note: notes().find(n => n.what === 'burst 1') ?? null,
        stepOk: stepRows.length > 0 && stepRows.every(r => r.ok),
        ...(stepRows.find(r => !r.ok)?.error ? { stepError: stepRows.find(r => !r.ok)!.error } : {})
    });
}

console.log(`cooking-accept ${which} ${variant}: ${where()}`);
/** The giver's afterRelog hand-off, started once staging has given it the notes. */
const startGiver = () => (async () => {
    if (!giver) return null;
    const g = await serveWine(giver, receiver, { log: (m, d) => console.log(`  giver: ${m} ${JSON.stringify(d ?? {})}`), cueTimeoutMs: 20 * 60_000 });
    console.log(`  giver: ${JSON.stringify(g)}`);
    return g;
})();
let giving: Promise<unknown> = Promise.resolve();
/** After staging: the giver arms (it sees SCORED now, so relog 1 is its gone-then-back), and the timeline starts at the step. */
const armed = () => {
    giving = startGiver();
    timeline.length = 0;
};
let cookingStart = 1;
try {
    if (demo) {
        // no staff commands: S00's skip off the island if needed, then the walk to the stand tile
        await offIsland(recv);
        const p = state().player;
        if (!p || Math.abs(p.worldX - SCORED_TILE.x) > 1 || Math.abs(p.worldZ - SCORED_TILE.z) > 1) await recv.bot.walkTo(SCORED_TILE.x, SCORED_TILE.z, 0);
        await waitUntil(sdk, s => s.nearbyLocs.some(l => l.id === VARROCK_WEST.id && l.x === VARROCK_WEST.x && l.z === VARROCK_WEST.z), { maxTicks: 60 });
        cookingStart = state().skills.find(k => k.name === 'Cooking')?.baseLevel ?? 1;
        timeline.length = 0;
        result.account = { cooking: cookingStart, at: [state().player?.worldX, state().player?.worldZ], held: state().inventory.length };
        await runSteps(session, steps({ giver: giverName, lab: true, windowWork: 'none' }), { log, c: {}, shouldStop: () => false, logout: async () => {}, tickMonitor: false });
    } else if (which === 'ww') {
        await stage({ cooking: 1, crafting: 55, gems: { uncut_dragonstone: WW_QUOTA }, chisel: 'held' });
        cookingStart = 1;
        armed();
        const opts: CookingOptions = { giver: giverName, lab: true, recipes: [DRAGONSTONE], windowWork: variant === 'plain' ? 'none' : 'gems' };
        await runSteps(session, steps(opts), { log, c: {}, shouldStop: () => false, logout: async () => {}, tickMonitor: false });
        // the rest of the quota, standalone at the booth (WW: both ends are "last quota action")
        const cutSoFar = state().bank.items.filter(i => i.id === DRAGONSTONE.products[0]).reduce((n, i) => n + i.count, 0);
        const done = variant === 'plain' ? 0 : notes().filter(n => n.what === 'S25c end').at(-1)?.cut as number;
        const rest = WW_QUOTA - (done ?? cutSoFar);
        if (rest > 0) await runItemCycle({ sdk, session, log }, { mode: 'tool', skill: 'crafting', recipes: [DRAGONSTONE], booth: boothFor(state()), maxActions: rest, step: 'S25c lab standalone' });
        result.quota = { inWindows: done ?? 0, standalone: rest };
    } else {
        await stage({ cooking: 30, crafting: levelForXp(craftingHandoffXp(loadStagedGems())), gems: RUN_GEMS, chisel: chiselAt });
        cookingStart = 30;
        armed();
        if (which === 'run') {
            await runSteps(session, steps({ giver: giverName, lab: true }), { log, c: {}, shouldStop: () => false, logout: async () => {}, tickMonitor: false });
        } else {
            // drop the session at relog 2: the rest is banked, the second firing armed by the reconnect
            let calls = 0;
            const crashing = async (s: Session): Promise<RelogResult> => {
                if (++calls === 1) return relog(s);
                const out = await logoutClean(s);
                console.log(`  simulated drop at relog 2: ${JSON.stringify(out)}`);
                throw new Error('simulated drop at relog 2');
            };
            await runSteps(session, steps({ giver: giverName, lab: true, relog: crashing }), { log, c: {}, shouldStop: () => false, logout: async () => {}, tickMonitor: false }).catch(e => console.log(`  step ended: ${e instanceof Error ? e.message : String(e)}`));
            await Bun.sleep(3_000);
            const back = await login(recv);
            console.log(`  logged in again: ${JSON.stringify(back)}`);
            const obs = new Observation(state(), PROBES as never, session);
            const point = await resolveResume(steps({ giver: giverName, lab: true }), obs, {});
            result.resume = { mode: point.mode, step: point.step, reason: point.reason, probe: obs.probed.wineBank ?? null, tickBase: recv.tickBase };
            await runSteps(session, steps({ giver: giverName, lab: true }), { log, c: {}, shouldStop: () => false, logout: async () => {}, startMode: point.mode === 'resume' ? 'resume' : 'run', observed: obs, tickMonitor: false });
        }
    }
} catch (e) {
    exitCode = 1;
    result.error = e instanceof Error ? e.message : String(e);
} finally {
    report(cookingStart);
    console.log(`RESULT ${JSON.stringify({ ...result, xp99: xpForLevel(99), host: hostname(), log: log.path })}`);
    await Promise.race([giving, Bun.sleep(1_000)]);
    for (const s of giver ? [recv, giver] : [recv]) {
        await logoutClean(s).catch(() => {});
        await closeSession(s).catch(() => {});
    }
    await chrome?.kill().catch(() => {});
}
process.exit(exitCode);
